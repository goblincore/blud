//! NATIVE-RENDERER SPIKE (ray tracing): does a hardware BVH help the march?
//!
//! Sphere-traces a crowd of one character's primitives (exported by
//! scripts/native-spike/export-prims.ts) four ways — see rt_spike.wgsl — and
//! times each with the protocol the replay spike uses: K back-to-back passes
//! in one command buffer, submit to completion, divided by K. The legs
//! alternate, because this machine's thermal drift is as large as the effect.
//!
//!   rt-spike <prims.json> [--scene closeup|crowd] [--bodies N] [--size WxH]
//!            [--repeat K] [--rounds N] [--reps R] [--png PREFIX]
//!
//! This is NOT the game's shader: no wounds, carves, shells, strands, noise or
//! lighting. It compares techniques on the game's geometry, nothing more.

use serde_json::Value;
use std::time::Instant;

const SHADER: &str = include_str!("rt_spike.wgsl");
const MODES: [&str; 4] = ["cull", "softmask", "rtmask", "cullspan"];
/// pack.ts GROUP_RADIUS_MAX: the game's second-level bound groups.
const GROUP_RADIUS_MAX: f32 = 0.16;

const RT_COLLECT: &str = "
    var rq: ray_query;
    rayQueryInitialize(&rq, tlas, RayDesc(RAY_FLAG_NONE, 0xFFu, 0.0, 1000.0, u.camPos.xyz, rd));
    while (rayQueryProceed(&rq)) {
      let c = rayQueryGetCandidateIntersection(&rq);
      if (c.kind != RAY_QUERY_INTERSECTION_AABB) { continue; }
      candidates += 1.0;
      var j = 0u;
      while (j < n && ids[j] != c.instance_custom_data) { j++; }
      if (j == n) {
        if (n == 8u) { overflow += 1.0; continue; }
        ids[n] = c.instance_custom_data; m0s[n] = 0u; m1s[n] = 0u; n++;
      }
      if (c.primitive_index < 32u) { m0s[j] |= 1u << c.primitive_index; }
      else { m1s[j] |= 1u << (c.primitive_index - 32u); }
    }";

type V3 = [f32; 3];
fn v3(v: &Value) -> V3 { [v[0].as_f64().unwrap() as f32, v[1].as_f64().unwrap() as f32, v[2].as_f64().unwrap() as f32] }
fn sub(a: V3, b: V3) -> V3 { [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
fn len(a: V3) -> f32 { (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt() }
fn norm(a: V3) -> V3 { let l = len(a); [a[0] / l, a[1] / l, a[2] / l] }
fn cross(a: V3, b: V3) -> V3 { [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
fn bytes(v: &[f32]) -> Vec<u8> { v.iter().flat_map(|f| f.to_le_bytes()).collect() }

struct Scene {
    prims: Vec<f32>,   // 6 vec4 a prim
    boxes: Vec<f32>,   // min xyz, max xyz a prim
    groups: Vec<f32>,  // 2 vec4 a group
    bound: [f32; 4],
    margin4k: f32,
    count: usize,
}

fn load_scene(path: &str) -> Scene {
    let doc: Value = serde_json::from_slice(&std::fs::read(path).expect("prims json")).expect("prims json");
    let list = doc["prims"].as_array().unwrap();
    assert!(list.len() <= 64, "the per-ray mask holds 64 prims; {} has {}", path, list.len());
    let kmax = list.iter().map(|p| p["blendK"].as_f64().unwrap() as f32).fold(0.0, f32::max);
    let margin4k = 4.0 * kmax;
    let (mut prims, mut boxes) = (Vec::new(), Vec::new());
    // per prim: world-space reach (centre segment + extent) for the bounds
    let mut reach: Vec<(V3, V3, f32, f32, i64)> = Vec::new();
    for p in list {
        let (a, b, scale) = (v3(&p["a"]), v3(&p["b"]), v3(&p["scale"]));
        let (r, rb) = (p["radius"].as_f64().unwrap() as f32, p["radiusB"].as_f64().unwrap() as f32);
        let o: Vec<f32> = p["orient"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap() as f32).collect();
        let k = p["blendK"].as_f64().unwrap() as f32;
        let (smin, smax) = (scale.iter().cloned().fold(f32::MAX, f32::min), scale.iter().cloned().fold(0.0, f32::max));
        // The field under-reports distance by up to maxScale/minScale, so a
        // box must be that much fatter to hold everything within 4k of it.
        let pad = margin4k * smax / smin;
        let oriented = (1.0 - o[3]).abs() > 1e-6;
        let rmax = r.max(rb);
        let ext: V3 = if oriented { [rmax * smax; 3] } else { [rmax * scale[0], rmax * scale[1], rmax * scale[2]] };
        let lo: V3 = std::array::from_fn(|i| a[i].min(b[i]) - ext[i] - pad);
        let hi: V3 = std::array::from_fn(|i| a[i].max(b[i]) + ext[i] + pad);
        prims.extend([a[0], a[1], a[2], r, b[0], b[1], b[2], rb, 1.0 / scale[0], 1.0 / scale[1], 1.0 / scale[2], smin]);
        prims.extend([o[0], o[1], o[2], o[3], lo[0], lo[1], lo[2], k, hi[0], hi[1], hi[2], if p["chamfer"].as_bool().unwrap_or(false) { 1.0 } else { 0.0 }]);
        boxes.extend([lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]]);
        reach.push((a, b, rmax * smax, smin / smax, p["cluster"].as_i64().unwrap_or(0)));
    }
    // Bound groups: consecutive prims of one cluster whose sphere stays small.
    let sphere = |run: &[(V3, V3, f32, f32, i64)]| -> ([f32; 3], f32) {
        let n = (run.len() * 2) as f32;
        let c: V3 = std::array::from_fn(|i| run.iter().map(|p| p.0[i] + p.1[i]).sum::<f32>() / n);
        let r = run.iter().map(|p| len(sub(p.0, c)).max(len(sub(p.1, c))) + p.2).fold(0.0, f32::max);
        (c, r)
    };
    let mut groups = Vec::new();
    let mut start = 0;
    while start < reach.len() {
        let mut end = start + 1;
        while end < reach.len() && reach[end].4 == reach[start].4 && sphere(&reach[start..=end]).1 <= GROUP_RADIUS_MAX { end += 1; }
        let (c, r) = sphere(&reach[start..end]);
        let distort = reach[start..end].iter().map(|p| p.3).fold(1.0, f32::min);
        groups.extend([c[0], c[1], c[2], r, start as f32, (end - start) as f32, distort, 0.0]);
        start = end;
    }
    let (c, r) = sphere(&reach);
    Scene { prims, boxes, groups, bound: [c[0], c[1], c[2], r + margin4k], margin4k, count: list.len() }
}

struct Args { prims: String, scene: String, bodies: usize, w: u32, h: u32, repeat: u32, rounds: u32, reps: u32, png: Option<String> }

fn parse_args() -> Args {
    let mut a = Args { prims: String::new(), scene: "crowd".into(), bodies: 24, w: 400, h: 300, repeat: 10, rounds: 15, reps: 5, png: None };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        let mut next = || it.next().unwrap_or_else(|| panic!("{arg} needs a value"));
        match arg.as_str() {
            "--scene" => a.scene = next(),
            "--bodies" => a.bodies = next().parse().unwrap(),
            "--size" => { let s = next(); let (w, h) = s.split_once('x').expect("--size WxH"); a.w = w.parse().unwrap(); a.h = h.parse().unwrap(); }
            "--repeat" => a.repeat = next().parse().unwrap(),
            "--rounds" => a.rounds = next().parse().unwrap(),
            "--reps" => a.reps = next().parse().unwrap(),
            "--png" => a.png = Some(next()),
            _ => a.prims = arg,
        }
    }
    if a.prims.is_empty() { eprintln!("usage: rt-spike <prims.json> [--scene closeup|crowd] [--bodies N] [--size WxH] [--repeat K] [--rounds N] [--reps R] [--png PREFIX]"); std::process::exit(2); }
    a
}

struct Leg { pipeline: wgpu::RenderPipeline, bind: wgpu::BindGroup }

fn main() {
    let args = parse_args();
    let scene = load_scene(&args.prims);

    // Bodies on a floor grid, six abreast; the close-up is one body.
    let (offsets, eye, target): (Vec<V3>, V3, V3) = if args.scene == "closeup" {
        (vec![[0.0, 0.0, 0.0]], [0.0, 1.2, 0.9], [0.0, 1.1, 0.0])
    } else {
        let per_row = 6;
        let offsets = (0..args.bodies).map(|i| {
            [(i % per_row) as f32 * 0.9 - (per_row - 1) as f32 * 0.45, 0.0, -((i / per_row) as f32) * 0.9]
        }).collect();
        (offsets, [0.0, 1.7, 3.2], [0.0, 0.9, -1.0])
    };
    let fwd = norm(sub(target, eye));
    let right = norm(cross(fwd, [0.0, 1.0, 0.0]));
    let up = cross(right, fwd);
    let uniform: Vec<f32> = [
        [eye[0], eye[1], eye[2], 0.0], [right[0], right[1], right[2], 0.0], [up[0], up[1], up[2], 0.0],
        [fwd[0], fwd[1], fwd[2], (30f32).to_radians().tan()],
        [args.w as f32, args.h as f32, offsets.len() as f32, scene.count as f32],
        scene.bound,
        [scene.margin4k, (scene.groups.len() / 8) as f32, 96.0, 0.0],
    ].concat();

    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance, force_fallback_adapter: false,
        compatible_surface: None, apply_limit_buckets: false,
    })).expect("no GPU adapter");
    let rt = adapter.features().contains(wgpu::Features::EXPERIMENTAL_RAY_QUERY);
    assert!(rt, "this adapter has no ray query support");
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("rt-spike"),
        required_features: wgpu::Features::EXPERIMENTAL_RAY_QUERY | wgpu::Features::TIMESTAMP_QUERY,
        required_limits: adapter.limits(),
        // SAFETY: ray queries are behind wgpu's experimental gate; this is a spike.
        experimental_features: unsafe { wgpu::ExperimentalFeatures::enabled() },
        ..Default::default()
    })).expect("no device");

    let buffer = |data: &[f32], usage: wgpu::BufferUsages| {
        let b = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: (data.len() * 4) as u64, usage: usage | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        queue.write_buffer(&b, 0, &bytes(data));
        b
    };
    let u_buf = buffer(&uniform, wgpu::BufferUsages::UNIFORM);
    let p_buf = buffer(&scene.prims, wgpu::BufferUsages::STORAGE);
    let b_buf = buffer(&offsets.iter().flat_map(|o| [o[0], o[1], o[2], 0.0]).collect::<Vec<_>>(), wgpu::BufferUsages::STORAGE);
    let g_buf = buffer(&scene.groups, wgpu::BufferUsages::STORAGE);

    // One BLAS of the character's primitive boxes, instanced once per body.
    let t_build = Instant::now();
    let aabb_buf = buffer(&scene.boxes, wgpu::BufferUsages::BLAS_INPUT);
    let size = wgpu::BlasAABBGeometrySizeDescriptor { primitive_count: scene.count as u32, flags: wgpu::AccelerationStructureGeometryFlags::empty() };
    let blas = device.create_blas(
        &wgpu::CreateBlasDescriptor { label: None, flags: wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE, update_mode: wgpu::AccelerationStructureUpdateMode::Build },
        wgpu::BlasGeometrySizeDescriptors::AABBs { descriptors: vec![size.clone()] },
    );
    let mut tlas = device.create_tlas(&wgpu::CreateTlasDescriptor {
        label: None, max_instances: offsets.len() as u32,
        flags: wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE, update_mode: wgpu::AccelerationStructureUpdateMode::Build,
    });
    for (i, o) in offsets.iter().enumerate() {
        tlas[i] = Some(wgpu::TlasInstance::new(&blas, [1.0, 0.0, 0.0, o[0], 0.0, 1.0, 0.0, o[1], 0.0, 0.0, 1.0, o[2]], i as u32, 0xFF));
    }
    let mut enc = device.create_command_encoder(&Default::default());
    enc.build_acceleration_structures(
        [&wgpu::BlasBuildEntry { blas: &blas, geometry: wgpu::BlasGeometries::AabbGeometries(vec![wgpu::BlasAabbGeometry { size: &size, stride: 24, aabb_buffer: &aabb_buf, primitive_offset: 0 }]) }],
        [&tlas],
    );
    queue.submit([enc.finish()]);
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    let build_ms = t_build.elapsed().as_secs_f64() * 1e3;

    let target = |_: u32| device.create_texture(&wgpu::TextureDescriptor {
        label: None, size: wgpu::Extent3d { width: args.w, height: args.h, depth_or_array_layers: 1 },
        mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2, format: wgpu::TextureFormat::Rgba32Float,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC, view_formats: &[],
    });
    let (color, stats) = (target(0), target(1));
    let (color_view, stats_view) = (color.create_view(&Default::default()), stats.create_view(&Default::default()));

    let legs: Vec<Leg> = (0..4u32).map(|mode| {
        let mut code = format!("const MODE: u32 = {mode}u;\n{}", SHADER.replace("RT_COLLECT", if mode == 2 { RT_COLLECT } else { "" }));
        if mode == 2 { code = format!("enable wgpu_ray_query;\n@group(0) @binding(4) var tlas: acceleration_structure;\n{code}"); }
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some(MODES[mode as usize]), source: wgpu::ShaderSource::Wgsl(code.into()) });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(MODES[mode as usize]), layout: None,
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
            primitive: Default::default(), depth_stencil: None, multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module, entry_point: Some("fs"), compilation_options: Default::default(),
                targets: &[Some(wgpu::TextureFormat::Rgba32Float.into()), Some(wgpu::TextureFormat::Rgba32Float.into())],
            }),
            multiview_mask: None, cache: None,
        });
        let mut entries = vec![
            wgpu::BindGroupEntry { binding: 0, resource: u_buf.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: p_buf.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 2, resource: b_buf.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 3, resource: g_buf.as_entire_binding() },
        ];
        if mode == 2 { entries.push(wgpu::BindGroupEntry { binding: 4, resource: tlas.as_binding() }); }
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout: &pipeline.get_bind_group_layout(0), entries: &entries });
        Leg { pipeline, bind }
    }).collect();

    let encode = |enc: &mut wgpu::CommandEncoder, leg: &Leg| {
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[&color_view, &stats_view].map(|view| Some(wgpu::RenderPassColorAttachment {
                view, depth_slice: None, resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
            })),
            depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None, multiview_mask: None,
        });
        pass.set_pipeline(&leg.pipeline);
        pass.set_bind_group(0, &leg.bind, &[]);
        pass.draw(0..3, 0..1);
    };
    let read = |tex: &wgpu::Texture| -> Vec<f32> {
        let bpr = (args.w * 16).div_ceil(256) * 256;
        let staging = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: (bpr * args.h) as u64, usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let mut enc = device.create_command_encoder(&Default::default());
        enc.copy_texture_to_buffer(
            tex.as_image_copy(),
            wgpu::TexelCopyBufferInfo { buffer: &staging, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(bpr), rows_per_image: Some(args.h) } },
            wgpu::Extent3d { width: args.w, height: args.h, depth_or_array_layers: 1 },
        );
        queue.submit([enc.finish()]);
        staging.slice(..).map_async(wgpu::MapMode::Read, |r| r.expect("map"));
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        let data = staging.slice(..).get_mapped_range().expect("mapped range");
        (0..args.h as usize).flat_map(|y| {
            let row = &data[y * bpr as usize..y * bpr as usize + args.w as usize * 16];
            row.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect::<Vec<_>>()
        }).collect()
    };

    // One frame of each: the picture, the work counters, and the cold compile.
    let px = (args.w * args.h) as f64;
    let mut images = Vec::new();
    let mut rows = Vec::new();
    for (mode, leg) in legs.iter().enumerate() {
        let t0 = Instant::now();
        let mut enc = device.create_command_encoder(&Default::default());
        encode(&mut enc, leg);
        queue.submit([enc.finish()]);
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        let first_ms = t0.elapsed().as_secs_f64() * 1e3;
        let (img, st) = (read(&color), read(&stats));
        let sum = |c: usize| st.chunks_exact(4).map(|p| p[c] as f64).sum::<f64>();
        let hits = img.chunks_exact(4).filter(|p| p[3] > 0.0).count() as f64;
        rows.push(format!(
            "\"{}\":{{\"stepsPerPx\":{:.2},\"evalsPerPx\":{:.1},\"candidatesPerPx\":{:.2},\"overflowPx\":{:.0},\"hitFrac\":{:.3},\"firstFrameMs\":{:.0}}}",
            MODES[mode], sum(0) / px, sum(1) / px, sum(2) / px, sum(3), hits / px, first_ms,
        ));
        if let Some(prefix) = &args.png {
            let rgb: Vec<u8> = img.chunks_exact(4).flat_map(|p| [0, 1, 2].map(|c| (255.0 * p[c].clamp(0.0, 1.0).powf(1.0 / 2.2)) as u8)).collect();
            let mut e = png::Encoder::new(std::io::BufWriter::new(std::fs::File::create(format!("{prefix}-{}.png", MODES[mode])).unwrap()), args.w, args.h);
            e.set_color(png::ColorType::Rgb);
            e.write_header().unwrap().write_image_data(&rgb).unwrap();
        }
        images.push(img);
    }
    // The three legs must draw the same picture or they are not the same work.
    let differ = |a: &[f32], b: &[f32]| a.chunks_exact(4).zip(b.chunks_exact(4)).filter(|(x, y)| (0..4).any(|c| (x[c] - y[c]).abs() > 2e-2)).count() as f64 / px;
    let parity = format!(
        "\"softmaskVsCull\":{:.5},\"rtmaskVsCull\":{:.5},\"cullspanVsCull\":{:.5}",
        differ(&images[1], &images[0]), differ(&images[2], &images[0]), differ(&images[3], &images[0]),
    );

    let round = |leg: &Leg| -> f64 {
        let mut enc = device.create_command_encoder(&Default::default());
        for _ in 0..args.repeat { encode(&mut enc, leg); }
        let buf = enc.finish();
        let t0 = Instant::now();
        let index = queue.submit([buf]);
        device.poll(wgpu::PollType::Wait { submission_index: Some(index), timeout: None }).unwrap();
        t0.elapsed().as_secs_f64() * 1e3 / args.repeat as f64
    };
    let median = |v: &mut Vec<f64>| { v.sort_by(|a, b| a.partial_cmp(b).unwrap()); v[v.len() / 2] };
    let mut runs: Vec<Vec<f64>> = vec![Vec::new(); 4];
    for rep in 0..args.reps as usize {
        for k in 0..4 {
            let mode = (k + rep) % 4; // rotate so no leg always runs coolest
            for _ in 0..3 { round(&legs[mode]); }
            let mut ms: Vec<f64> = (0..args.rounds).map(|_| round(&legs[mode])).collect();
            runs[mode].push(median(&mut ms));
        }
    }
    let timing: Vec<String> = (0..4).map(|m| {
        let lo = runs[m].iter().cloned().fold(f64::MAX, f64::min);
        let hi = runs[m].iter().cloned().fold(0.0, f64::max);
        format!("\"{}\":{{\"medianMs\":{:.3},\"lo\":{:.3},\"hi\":{:.3}}}", MODES[m], median(&mut runs[m].clone()), lo, hi)
    }).collect();
    println!(
        "{{\"prims\":\"{}\",\"primCount\":{},\"groups\":{},\"scene\":\"{}\",\"bodies\":{},\"size\":\"{}x{}\",\"bvhBuildMs\":{:.1},\"work\":{{{}}},\"parity\":{{{}}},\"timing\":{{{}}}}}",
        args.prims, scene.count, scene.groups.len() / 8, args.scene, offsets.len(), args.w, args.h, build_ms,
        rows.join(","), parity, timing.join(","),
    );
}
