//! NATIVE-RENDERER SPIKE, step 2b: replay a march pass captured from the
//! browser (scripts/native-spike/capture.mjs) through wgpu, and time it.
//!
//! The capture is the game's own WGSL, pipeline state, bind groups and
//! resource contents for one frame's `sdf:march` pass. This program rebuilds
//! exactly that from `manifest.json` and runs the same measurement
//! `scripts/native-spike/replay.html` runs in Chrome: K back-to-back copies of
//! the pass in one command buffer, wall-clock from submit to completion,
//! divided by K. Same shader text, same inputs, same protocol — what differs
//! is the stack underneath (Chrome's Dawn/Tint vs wgpu/naga, a GPU process vs
//! none).
//!
//!   march-replay <capture-dir> [--repeat K] [--rounds N] [--unchecked]
//!                [--manifest NAME] [--png out.png]
//!                [--window [--no-vsync] [--frames N]]
//!
//! The manifest defaults to `manifest.naga.json`, the capture after
//! scripts/native-spike/naga-compat.mjs: naga rejects the storage-pointer
//! parameters the game's WGSL uses, so the untouched `manifest.json` does not
//! compile here.
//!
//! `--unchecked` compiles the shaders without naga's bounds checks and loop
//! bounding — the cost of WebGPU's safety codegen, which a shipped native
//! renderer may drop. `--window` opens a window and presents the replayed pass
//! every frame instead of timing it offscreen.

mod window;

use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::Instant;

pub struct Args {
    pub dir: PathBuf,
    pub manifest: String,
    pub repeat: u32,
    pub rounds: u32,
    pub unchecked: bool,
    pub png: Option<PathBuf>,
    pub window: bool,
    pub vsync: bool,
    /// `--window` only: exit after this many frames and print their timing.
    pub frames: u32,
}

fn parse_args() -> Args {
    let mut a = Args { dir: PathBuf::new(), manifest: "manifest.naga.json".into(), repeat: 20, rounds: 30, unchecked: false, png: None, window: false, vsync: true, frames: 0 };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--repeat" => a.repeat = it.next().expect("--repeat K").parse().expect("--repeat K"),
            "--rounds" => a.rounds = it.next().expect("--rounds N").parse().expect("--rounds N"),
            "--manifest" => a.manifest = it.next().expect("--manifest NAME"),
            "--unchecked" => a.unchecked = true,
            "--png" => a.png = Some(it.next().expect("--png FILE").into()),
            "--window" => a.window = true,
            "--no-vsync" => a.vsync = false,
            "--frames" => a.frames = it.next().expect("--frames N").parse().expect("--frames N"),
            _ => a.dir = arg.into(),
        }
    }
    if a.dir.as_os_str().is_empty() {
        eprintln!("usage: march-replay <capture-dir> [--repeat K] [--rounds N] [--unchecked] [--manifest NAME] [--png FILE] [--window [--no-vsync] [--frames N]]");
        std::process::exit(2);
    }
    a
}

// ---- WebGPU JSON -> wgpu ---------------------------------------------------

fn s<'a>(v: &'a Value, key: &str) -> Option<&'a str> { v.get(key).and_then(Value::as_str) }
fn u(v: &Value, key: &str) -> Option<u64> { v.get(key).and_then(Value::as_u64) }
fn id_of(v: &Value) -> u64 { v["$ref"].as_u64().expect("expected a { $ref }") }

fn texture_format(name: &str) -> wgpu::TextureFormat {
    use wgpu::TextureFormat as F;
    match name {
        "r8unorm" => F::R8Unorm, "rg8unorm" => F::Rg8Unorm, "rgba8unorm" => F::Rgba8Unorm,
        "rgba8unorm-srgb" => F::Rgba8UnormSrgb, "bgra8unorm" => F::Bgra8Unorm,
        "bgra8unorm-srgb" => F::Bgra8UnormSrgb, "r16float" => F::R16Float, "rg16float" => F::Rg16Float,
        "rgba16float" => F::Rgba16Float, "r32float" => F::R32Float, "rg32float" => F::Rg32Float,
        "rgba32float" => F::Rgba32Float, "r32uint" => F::R32Uint, "rgba32uint" => F::Rgba32Uint,
        "r8uint" => F::R8Uint, "rgba8uint" => F::Rgba8Uint, "rg11b10ufloat" => F::Rg11b10Ufloat,
        "rgb10a2unorm" => F::Rgb10a2Unorm, "depth32float" => F::Depth32Float,
        "depth24plus" => F::Depth24Plus, "depth16unorm" => F::Depth16Unorm,
        "depth24plus-stencil8" => F::Depth24PlusStencil8,
        other => panic!("texture format {other} is not mapped"),
    }
}

fn compare(name: &str) -> wgpu::CompareFunction {
    use wgpu::CompareFunction as C;
    match name {
        "never" => C::Never, "less" => C::Less, "equal" => C::Equal, "less-equal" => C::LessEqual,
        "greater" => C::Greater, "not-equal" => C::NotEqual, "greater-equal" => C::GreaterEqual,
        "always" => C::Always,
        other => panic!("compare function {other} is not mapped"),
    }
}

fn view_dimension(name: Option<&str>) -> wgpu::TextureViewDimension {
    use wgpu::TextureViewDimension as D;
    match name {
        None | Some("2d") => D::D2, Some("2d-array") => D::D2Array, Some("cube") => D::Cube,
        Some("cube-array") => D::CubeArray, Some("3d") => D::D3, Some("1d") => D::D1,
        Some(other) => panic!("view dimension {other} is not mapped"),
    }
}

fn vertex_format(name: &str) -> wgpu::VertexFormat {
    use wgpu::VertexFormat as V;
    match name {
        "float32" => V::Float32, "float32x2" => V::Float32x2, "float32x3" => V::Float32x3,
        "float32x4" => V::Float32x4, "uint32" => V::Uint32, "uint32x2" => V::Uint32x2,
        "uint32x3" => V::Uint32x3, "uint32x4" => V::Uint32x4, "sint32" => V::Sint32,
        other => panic!("vertex format {other} is not mapped"),
    }
}

fn index_format(name: &str) -> wgpu::IndexFormat {
    if name == "uint16" { wgpu::IndexFormat::Uint16 } else { wgpu::IndexFormat::Uint32 }
}

fn filter(name: Option<&str>) -> wgpu::FilterMode {
    if name == Some("linear") { wgpu::FilterMode::Linear } else { wgpu::FilterMode::Nearest }
}

fn address(name: Option<&str>) -> wgpu::AddressMode {
    match name {
        Some("repeat") => wgpu::AddressMode::Repeat,
        Some("mirror-repeat") => wgpu::AddressMode::MirrorRepeat,
        _ => wgpu::AddressMode::ClampToEdge,
    }
}

fn blend_factor(name: &str) -> wgpu::BlendFactor {
    use wgpu::BlendFactor as B;
    match name {
        "zero" => B::Zero, "one" => B::One, "src" => B::Src, "one-minus-src" => B::OneMinusSrc,
        "src-alpha" => B::SrcAlpha, "one-minus-src-alpha" => B::OneMinusSrcAlpha, "dst" => B::Dst,
        "one-minus-dst" => B::OneMinusDst, "dst-alpha" => B::DstAlpha,
        "one-minus-dst-alpha" => B::OneMinusDstAlpha,
        other => panic!("blend factor {other} is not mapped"),
    }
}

fn blend_component(v: &Value) -> wgpu::BlendComponent {
    use wgpu::BlendOperation as O;
    wgpu::BlendComponent {
        src_factor: blend_factor(s(v, "srcFactor").unwrap_or("one")),
        dst_factor: blend_factor(s(v, "dstFactor").unwrap_or("zero")),
        operation: match s(v, "operation") {
            None | Some("add") => O::Add, Some("subtract") => O::Subtract,
            Some("reverse-subtract") => O::ReverseSubtract, Some("min") => O::Min, Some("max") => O::Max,
            Some(other) => panic!("blend operation {other} is not mapped"),
        },
    }
}

fn bind_group_layout_entry(e: &Value) -> wgpu::BindGroupLayoutEntry {
    let ty = if let Some(b) = e.get("buffer") {
        wgpu::BindingType::Buffer {
            ty: match s(b, "type") {
                None | Some("uniform") => wgpu::BufferBindingType::Uniform,
                Some("storage") => wgpu::BufferBindingType::Storage { read_only: false },
                Some("read-only-storage") => wgpu::BufferBindingType::Storage { read_only: true },
                Some(other) => panic!("buffer binding type {other} is not mapped"),
            },
            has_dynamic_offset: b.get("hasDynamicOffset").and_then(Value::as_bool).unwrap_or(false),
            min_binding_size: None,
        }
    } else if let Some(t) = e.get("texture") {
        wgpu::BindingType::Texture {
            sample_type: match s(t, "sampleType") {
                None | Some("float") => wgpu::TextureSampleType::Float { filterable: true },
                Some("unfilterable-float") => wgpu::TextureSampleType::Float { filterable: false },
                Some("depth") => wgpu::TextureSampleType::Depth,
                Some("uint") => wgpu::TextureSampleType::Uint,
                Some("sint") => wgpu::TextureSampleType::Sint,
                Some(other) => panic!("texture sample type {other} is not mapped"),
            },
            view_dimension: view_dimension(s(t, "viewDimension")),
            multisampled: t.get("multisampled").and_then(Value::as_bool).unwrap_or(false),
        }
    } else if let Some(sm) = e.get("sampler") {
        wgpu::BindingType::Sampler(match s(sm, "type") {
            None | Some("filtering") => wgpu::SamplerBindingType::Filtering,
            Some("non-filtering") => wgpu::SamplerBindingType::NonFiltering,
            Some("comparison") => wgpu::SamplerBindingType::Comparison,
            Some(other) => panic!("sampler binding type {other} is not mapped"),
        })
    } else {
        panic!("bind group layout entry kind is not mapped: {e}");
    };
    wgpu::BindGroupLayoutEntry {
        binding: u(e, "binding").unwrap() as u32,
        visibility: wgpu::ShaderStages::from_bits_truncate(u(e, "visibility").unwrap() as u32),
        ty,
        count: None,
    }
}

// ---- the replay ------------------------------------------------------------

enum Obj {
    Buffer(wgpu::Buffer),
    Texture(wgpu::Texture),
    View(wgpu::TextureView),
    Sampler(wgpu::Sampler),
    Module(wgpu::ShaderModule),
    Layout(wgpu::BindGroupLayout),
    PipelineLayout(wgpu::PipelineLayout),
    Pipeline(wgpu::RenderPipeline),
    BindGroup(wgpu::BindGroup),
}

macro_rules! getter {
    ($name:ident, $variant:ident, $ty:ty) => {
        fn $name(&self, r: &Value) -> $ty {
            match self.objs.get(&id_of(r)) {
                Some(Obj::$variant(o)) => o.clone(),
                _ => panic!("object {} is not a {}", id_of(r), stringify!($variant)),
            }
        }
    };
}

/// Everything one captured pass needs, rebuilt on this device.
pub struct Pass {
    pub label: String,
    desc: Value,
    cmds: Vec<Value>,
    objs: HashMap<u64, Obj>,
    /// Colour attachment 0's texture id and the capture's own readback of it.
    output: Option<(u64, PathBuf, u32, u32)>,
}

impl Pass {
    getter!(buffer, Buffer, wgpu::Buffer);
    getter!(view, View, wgpu::TextureView);
    getter!(pipeline, Pipeline, wgpu::RenderPipeline);
    getter!(bind_group, BindGroup, wgpu::BindGroup);

    pub fn output_view(&self) -> Option<wgpu::TextureView> {
        self.desc["colorAttachments"].get(0).filter(|a| !a.is_null()).map(|a| self.view(&a["view"]))
    }

    pub fn output_size(&self) -> (u32, u32) {
        self.output.as_ref().map(|o| (o.2, o.3)).unwrap_or((1, 1))
    }

    /// Encode the pass exactly as the page issued it.
    pub fn encode(&self, enc: &mut wgpu::CommandEncoder, timestamps: Option<(&wgpu::QuerySet, u32)>) {
        let d = &self.desc;
        let views: Vec<Option<(wgpu::TextureView, &Value)>> = d["colorAttachments"]
            .as_array().map(|a| a.iter().map(|c| (!c.is_null()).then(|| (self.view(&c["view"]), c))).collect())
            .unwrap_or_default();
        let color: Vec<Option<wgpu::RenderPassColorAttachment>> = views.iter().map(|v| {
            v.as_ref().map(|(view, c)| {
                let cv = &c["clearValue"];
                let ch = |name: &str, i: usize| cv.get(name).or_else(|| cv.get(i)).and_then(Value::as_f64).unwrap_or(0.0);
                wgpu::RenderPassColorAttachment {
                    view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: if s(c, "loadOp") == Some("clear") {
                            wgpu::LoadOp::Clear(wgpu::Color { r: ch("r", 0), g: ch("g", 1), b: ch("b", 2), a: ch("a", 3) })
                        } else { wgpu::LoadOp::Load },
                        store: if s(c, "storeOp") == Some("discard") { wgpu::StoreOp::Discard } else { wgpu::StoreOp::Store },
                    },
                }
            })
        }).collect();
        let ds = &d["depthStencilAttachment"];
        let depth_view = (!ds.is_null()).then(|| self.view(&ds["view"]));
        let depth = depth_view.as_ref().map(|view| wgpu::RenderPassDepthStencilAttachment {
            view,
            depth_ops: s(ds, "depthLoadOp").map(|load| wgpu::Operations {
                load: if load == "clear" {
                    wgpu::LoadOp::Clear(ds["depthClearValue"].as_f64().unwrap_or(1.0) as f32)
                } else { wgpu::LoadOp::Load },
                store: if s(ds, "depthStoreOp") == Some("discard") { wgpu::StoreOp::Discard } else { wgpu::StoreOp::Store },
            }),
            stencil_ops: s(ds, "stencilLoadOp").map(|load| wgpu::Operations {
                load: if load == "clear" {
                    wgpu::LoadOp::Clear(ds["stencilClearValue"].as_u64().unwrap_or(0) as u32)
                } else { wgpu::LoadOp::Load },
                store: if s(ds, "stencilStoreOp") == Some("discard") { wgpu::StoreOp::Discard } else { wgpu::StoreOp::Store },
            }),
        });
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(&self.label),
            color_attachments: &color,
            depth_stencil_attachment: depth,
            timestamp_writes: timestamps.map(|(query_set, first)| wgpu::RenderPassTimestampWrites {
                query_set,
                beginning_of_pass_write_index: Some(first),
                end_of_pass_write_index: Some(first + 1),
            }),
            occlusion_query_set: None,
            multiview_mask: None,
        });
        let num = |v: &Value| v.as_f64().unwrap_or(0.0);
        let int = |c: &Value, i: usize, default: u64| c.get(i).and_then(Value::as_u64).unwrap_or(default);
        for c in &self.cmds {
            match c[0].as_str().unwrap() {
                "setViewport" => pass.set_viewport(
                    num(&c[1]) as f32, num(&c[2]) as f32, num(&c[3]) as f32, num(&c[4]) as f32,
                    num(&c[5]) as f32, num(&c[6]) as f32,
                ),
                "setScissorRect" => pass.set_scissor_rect(int(c, 1, 0) as u32, int(c, 2, 0) as u32, int(c, 3, 0) as u32, int(c, 4, 0) as u32),
                "setPipeline" => pass.set_pipeline(&self.pipeline(&c[1])),
                "setBindGroup" => {
                    let offsets: Vec<u32> = c.get(3).and_then(Value::as_array)
                        .map(|a| a.iter().map(|o| o.as_u64().unwrap() as u32).collect()).unwrap_or_default();
                    pass.set_bind_group(int(c, 1, 0) as u32, &self.bind_group(&c[2]), &offsets);
                }
                "setIndexBuffer" => {
                    let b = self.buffer(&c[1]);
                    pass.set_index_buffer(b.slice(int(c, 3, 0)..), index_format(c[2].as_str().unwrap()));
                }
                "setVertexBuffer" => {
                    let b = self.buffer(&c[2]);
                    pass.set_vertex_buffer(int(c, 1, 0) as u32, b.slice(int(c, 3, 0)..));
                }
                "draw" => {
                    let (first, first_instance) = (int(c, 3, 0) as u32, int(c, 4, 0) as u32);
                    pass.draw(first..first + int(c, 1, 0) as u32, first_instance..first_instance + int(c, 2, 1) as u32);
                }
                "drawIndexed" => {
                    let (first, first_instance) = (int(c, 3, 0) as u32, int(c, 5, 0) as u32);
                    pass.draw_indexed(
                        first..first + int(c, 1, 0) as u32,
                        c.get(4).and_then(Value::as_i64).unwrap_or(0) as i32,
                        first_instance..first_instance + int(c, 2, 1) as u32,
                    );
                }
                "setStencilReference" => pass.set_stencil_reference(int(c, 1, 0) as u32),
                other => panic!("pass command {other} is not mapped"),
            }
        }
    }
}

pub struct Replay {
    pub passes: Vec<Pass>,
}

/// Depth textures cannot be written from the CPU, so a captured one is drawn
/// back in: the blob goes into an r32float texture and this writes it as depth.
const DEPTH_FILL: &str = "
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4f) -> @builtin(frag_depth) f32 {
  return textureLoad(src, vec2u(p.xy), 0).r;
}";

fn fill_depth(device: &wgpu::Device, queue: &wgpu::Queue, texture: &wgpu::Texture, mip: u32, w: u32, h: u32, bytes: &[u8]) {
    let size = wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 };
    let src = device.create_texture(&wgpu::TextureDescriptor {
        label: None, size, mip_level_count: 1, sample_count: 1, dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::R32Float,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST, view_formats: &[],
    });
    queue.write_texture(
        src.as_image_copy(), bytes,
        wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(w * 4), rows_per_image: Some(h) }, size,
    );
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(DEPTH_FILL.into()) });
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: None, layout: None,
        vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
        primitive: Default::default(),
        depth_stencil: Some(wgpu::DepthStencilState {
            format: texture.format(), depth_write_enabled: Some(true), depth_compare: Some(wgpu::CompareFunction::Always),
            stencil: Default::default(), bias: Default::default(),
        }),
        multisample: Default::default(),
        fragment: Some(wgpu::FragmentState { module: &module, entry_point: Some("fs"), compilation_options: Default::default(), targets: &[] }),
        multiview_mask: None, cache: None,
    });
    let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: None, layout: &pipeline.get_bind_group_layout(0),
        entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&src.create_view(&Default::default())) }],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor { base_mip_level: mip, mip_level_count: Some(1), ..Default::default() });
    let mut enc = device.create_command_encoder(&Default::default());
    {
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None, color_attachments: &[],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &view,
                depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Clear(1.0), store: wgpu::StoreOp::Store }),
                stencil_ops: None,
            }),
            timestamp_writes: None, occlusion_query_set: None, multiview_mask: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }
    queue.submit([enc.finish()]);
}

impl Replay {
    pub fn load(dir: &Path, name: &str, device: &wgpu::Device, queue: &wgpu::Queue, unchecked: bool) -> (Replay, Value) {
        let manifest: Value = serde_json::from_slice(&std::fs::read(dir.join(name)).expect(name)).expect("manifest JSON");
        // Ids were handed out in creation order, and nothing can be created
        // before what it refers to — so ascending id order is a build order.
        let objects: BTreeMap<u64, &Value> = manifest["objects"].as_object().unwrap().iter()
            .map(|(k, v)| (k.parse().unwrap(), v)).collect();
        let mut passes = Vec::new();
        for rec in manifest["passes"].as_array().unwrap() {
            assert!(rec["pre"].as_object().map_or(true, |p| p.is_empty()), "a pass that LOADS an attachment is not supported yet");
            let mut p = Pass {
                label: s(rec, "label").unwrap_or("").to_string(),
                desc: rec["desc"].clone(),
                cmds: rec["cmds"].as_array().unwrap().clone(),
                objs: HashMap::new(),
                output: None,
            };
            for (&id, o) in &objects {
                let obj = build(&p, o, rec["res"].get(id.to_string()), dir, device, queue, unchecked);
                p.objs.insert(id, obj);
            }
            if let Some(a) = rec["desc"]["colorAttachments"].get(0).filter(|a| !a.is_null()) {
                let tex = id_of(&manifest["objects"][id_of(&a["view"]).to_string()]["texture"]);
                if let Some(m) = rec["post"].get(tex.to_string()).and_then(|t| t["mips"].get(0)) {
                    p.output = Some((tex, dir.join(s(m, "file").unwrap()), u(m, "width").unwrap() as u32, u(m, "height").unwrap() as u32));
                }
            }
            passes.push(p);
        }
        let meta = manifest["meta"].clone();
        (Replay { passes }, meta)
    }

    pub fn encode(&self, enc: &mut wgpu::CommandEncoder) {
        for p in &self.passes { p.encode(enc, None); }
    }
}

fn build(p: &Pass, o: &Value, contents: Option<&Value>, dir: &Path, device: &wgpu::Device, queue: &wgpu::Queue, unchecked: bool) -> Obj {
    let d = &o["desc"];
    match o["kind"].as_str().unwrap() {
        "buffer" => {
            let size = (u(d, "size").unwrap() + 3) & !3;
            let usage = wgpu::BufferUsages::from_bits_truncate(u(d, "usage").unwrap() as u32)
                - (wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::MAP_WRITE) | wgpu::BufferUsages::COPY_DST;
            let b = device.create_buffer(&wgpu::BufferDescriptor { label: None, size, usage, mapped_at_creation: false });
            if let Some(file) = contents.and_then(|c| s(c, "file")) {
                let mut bytes = std::fs::read(dir.join(file)).expect(file);
                bytes.resize(size as usize, 0);
                queue.write_buffer(&b, 0, &bytes);
            }
            Obj::Buffer(b)
        }
        "texture" => {
            let dims: Vec<u32> = d["size"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as u32).collect();
            let format = texture_format(s(d, "format").unwrap());
            let depth = format.is_depth_stencil_format();
            let dimension = match s(d, "dimension") {
                Some("3d") => wgpu::TextureDimension::D3, Some("1d") => wgpu::TextureDimension::D1, _ => wgpu::TextureDimension::D2,
            };
            let t = device.create_texture(&wgpu::TextureDescriptor {
                label: None,
                size: wgpu::Extent3d { width: dims[0], height: dims[1], depth_or_array_layers: dims[2] },
                mip_level_count: u(d, "mipLevelCount").unwrap_or(1) as u32,
                sample_count: u(d, "sampleCount").unwrap_or(1) as u32,
                dimension, format,
                usage: wgpu::TextureUsages::from_bits_truncate(u(d, "usage").unwrap() as u32) | wgpu::TextureUsages::COPY_SRC
                    | if depth { wgpu::TextureUsages::RENDER_ATTACHMENT } else { wgpu::TextureUsages::COPY_DST },
                view_formats: &[],
            });
            for (m, mip) in contents.and_then(|c| c["mips"].as_array()).into_iter().flatten().enumerate() {
                let (w, h, layers) = (u(mip, "width").unwrap() as u32, u(mip, "height").unwrap() as u32, u(mip, "layers").unwrap() as u32);
                let file = s(mip, "file").unwrap();
                let bytes = std::fs::read(dir.join(file)).expect(file);
                if depth {
                    fill_depth(device, queue, &t, m as u32, w, h, &bytes);
                } else {
                    queue.write_texture(
                        wgpu::TexelCopyTextureInfo { texture: &t, mip_level: m as u32, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                        &bytes,
                        wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(u(mip, "bytesPerRow").unwrap() as u32), rows_per_image: Some(h) },
                        wgpu::Extent3d { width: w, height: h, depth_or_array_layers: layers },
                    );
                }
            }
            Obj::Texture(t)
        }
        "view" => {
            let Some(Obj::Texture(t)) = p.objs.get(&id_of(&o["texture"])) else { panic!("view of a non-texture") };
            Obj::View(t.create_view(&wgpu::TextureViewDescriptor {
                format: s(d, "format").map(texture_format),
                dimension: s(d, "dimension").map(|n| view_dimension(Some(n))),
                base_mip_level: u(d, "baseMipLevel").unwrap_or(0) as u32,
                mip_level_count: u(d, "mipLevelCount").map(|n| n as u32),
                base_array_layer: u(d, "baseArrayLayer").unwrap_or(0) as u32,
                array_layer_count: u(d, "arrayLayerCount").map(|n| n as u32),
                ..Default::default()
            }))
        }
        "sampler" => Obj::Sampler(device.create_sampler(&wgpu::SamplerDescriptor {
            address_mode_u: address(s(d, "addressModeU")),
            address_mode_v: address(s(d, "addressModeV")),
            address_mode_w: address(s(d, "addressModeW")),
            mag_filter: filter(s(d, "magFilter")),
            min_filter: filter(s(d, "minFilter")),
            compare: s(d, "compare").map(compare),
            ..Default::default()
        })),
        "shaderModule" => {
            let desc = wgpu::ShaderModuleDescriptor { label: s(d, "label"), source: wgpu::ShaderSource::Wgsl(s(d, "code").unwrap().into()) };
            Obj::Module(if unchecked {
                // SAFETY: the shader is the game's own, already validated by
                // Chrome; dropping naga's runtime checks is the experiment.
                unsafe { device.create_shader_module_trusted(desc, wgpu::ShaderRuntimeChecks::unchecked()) }
            } else {
                device.create_shader_module(desc)
            })
        }
        "bindGroupLayout" => {
            let entries: Vec<_> = d["entries"].as_array().unwrap().iter().map(bind_group_layout_entry).collect();
            Obj::Layout(device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor { label: None, entries: &entries }))
        }
        "autoLayout" => {
            let Some(Obj::Pipeline(pl)) = p.objs.get(&id_of(&o["pipeline"])) else { panic!("auto layout of a non-pipeline") };
            Obj::Layout(pl.get_bind_group_layout(u(o, "index").unwrap() as u32))
        }
        "pipelineLayout" => {
            let layouts: Vec<wgpu::BindGroupLayout> = d["bindGroupLayouts"].as_array().unwrap().iter().map(|r| {
                let Some(Obj::Layout(l)) = p.objs.get(&id_of(r)) else { panic!("pipeline layout of a non-layout") };
                l.clone()
            }).collect();
            let refs: Vec<Option<&wgpu::BindGroupLayout>> = layouts.iter().map(Some).collect();
            Obj::PipelineLayout(device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: None, bind_group_layouts: &refs, immediate_size: 0 }))
        }
        "renderPipeline" => Obj::Pipeline(render_pipeline(p, d, device)),
        "bindGroup" => {
            let Some(Obj::Layout(layout)) = p.objs.get(&id_of(&d["layout"])) else { panic!("bind group of a non-layout") };
            let entries: Vec<wgpu::BindGroupEntry> = d["entries"].as_array().unwrap().iter().map(|e| {
                let r = &e["resource"];
                let resource = if r.get("$ref").is_some() {
                    match p.objs.get(&id_of(r)) {
                        Some(Obj::View(v)) => wgpu::BindingResource::TextureView(v),
                        Some(Obj::Sampler(sm)) => wgpu::BindingResource::Sampler(sm),
                        _ => panic!("bind group resource {} is neither a view nor a sampler", id_of(r)),
                    }
                } else {
                    let Some(Obj::Buffer(buffer)) = p.objs.get(&id_of(&r["buffer"])) else { panic!("bind group buffer missing") };
                    wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer,
                        offset: u(r, "offset").unwrap_or(0),
                        size: u(r, "size").and_then(std::num::NonZeroU64::new),
                    })
                };
                wgpu::BindGroupEntry { binding: u(e, "binding").unwrap() as u32, resource }
            }).collect();
            Obj::BindGroup(device.create_bind_group(&wgpu::BindGroupDescriptor { label: None, layout, entries: &entries }))
        }
        other => panic!("object kind {other} is not mapped"),
    }
}

fn render_pipeline(p: &Pass, d: &Value, device: &wgpu::Device) -> wgpu::RenderPipeline {
    let module = |r: &Value| match p.objs.get(&id_of(r)) {
        Some(Obj::Module(m)) => m.clone(),
        _ => panic!("pipeline stage without a shader module"),
    };
    let layout = d["layout"].get("$ref").map(|_| match p.objs.get(&id_of(&d["layout"])) {
        Some(Obj::PipelineLayout(l)) => l.clone(),
        _ => panic!("pipeline without a layout object"),
    });
    let vs = module(&d["vertex"]["module"]);
    let attrs: Vec<Vec<wgpu::VertexAttribute>> = d["vertex"]["buffers"].as_array().into_iter().flatten().map(|b| {
        b["attributes"].as_array().into_iter().flatten().map(|a| wgpu::VertexAttribute {
            format: vertex_format(s(a, "format").unwrap()),
            offset: u(a, "offset").unwrap_or(0),
            shader_location: u(a, "shaderLocation").unwrap() as u32,
        }).collect()
    }).collect();
    let buffers: Vec<Option<wgpu::VertexBufferLayout>> = d["vertex"]["buffers"].as_array().into_iter().flatten().zip(&attrs).map(|(b, a)| {
        (!b.is_null()).then(|| wgpu::VertexBufferLayout {
            array_stride: u(b, "arrayStride").unwrap(),
            step_mode: if s(b, "stepMode") == Some("instance") { wgpu::VertexStepMode::Instance } else { wgpu::VertexStepMode::Vertex },
            attributes: a,
        })
    }).collect();
    let prim = &d["primitive"];
    let primitive = wgpu::PrimitiveState {
        topology: match s(prim, "topology") {
            None | Some("triangle-list") => wgpu::PrimitiveTopology::TriangleList,
            Some("triangle-strip") => wgpu::PrimitiveTopology::TriangleStrip,
            Some("line-list") => wgpu::PrimitiveTopology::LineList,
            Some("point-list") => wgpu::PrimitiveTopology::PointList,
            Some(other) => panic!("topology {other} is not mapped"),
        },
        strip_index_format: s(prim, "stripIndexFormat").map(index_format),
        front_face: if s(prim, "frontFace") == Some("cw") { wgpu::FrontFace::Cw } else { wgpu::FrontFace::Ccw },
        cull_mode: match s(prim, "cullMode") {
            Some("back") => Some(wgpu::Face::Back), Some("front") => Some(wgpu::Face::Front), _ => None,
        },
        ..Default::default()
    };
    let ds = &d["depthStencil"];
    let depth_stencil = (!ds.is_null()).then(|| wgpu::DepthStencilState {
        format: texture_format(s(ds, "format").unwrap()),
        depth_write_enabled: Some(ds["depthWriteEnabled"].as_bool().unwrap_or(false)),
        depth_compare: Some(s(ds, "depthCompare").map(compare).unwrap_or(wgpu::CompareFunction::Always)),
        stencil: Default::default(),
        bias: Default::default(),
    });
    let frag = &d["fragment"];
    let fs = (!frag.is_null()).then(|| module(&frag["module"]));
    let targets: Vec<Option<wgpu::ColorTargetState>> = frag["targets"].as_array().into_iter().flatten().map(|t| {
        (!t.is_null()).then(|| wgpu::ColorTargetState {
            format: texture_format(s(t, "format").unwrap()),
            blend: t.get("blend").filter(|b| !b.is_null()).map(|b| wgpu::BlendState {
                color: blend_component(&b["color"]), alpha: blend_component(&b["alpha"]),
            }),
            write_mask: wgpu::ColorWrites::from_bits_truncate(u(t, "writeMask").unwrap_or(15) as u32),
        })
    }).collect();
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: s(d, "label"),
        layout: layout.as_ref(),
        vertex: wgpu::VertexState {
            module: &vs, entry_point: s(&d["vertex"], "entryPoint"), compilation_options: Default::default(), buffers: &buffers,
        },
        primitive,
        depth_stencil,
        multisample: wgpu::MultisampleState {
            count: u(&d["multisample"], "count").unwrap_or(1) as u32,
            mask: u(&d["multisample"], "mask").unwrap_or(0xFFFF_FFFF),
            alpha_to_coverage_enabled: d["multisample"]["alphaToCoverageEnabled"].as_bool().unwrap_or(false),
        },
        fragment: fs.as_ref().map(|module| wgpu::FragmentState {
            module, entry_point: s(frag, "entryPoint"), compilation_options: Default::default(), targets: &targets,
        }),
        multiview_mask: None,
        cache: None,
    })
}

// ---- device ----------------------------------------------------------------

pub async fn open_device(instance: &wgpu::Instance, surface: Option<&wgpu::Surface<'_>>) -> (wgpu::Adapter, wgpu::Device, wgpu::Queue) {
    let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: surface,
        apply_limit_buckets: false,
    }).await.expect("no GPU adapter");
    // What the page asked Chrome for, where this adapter has it.
    let wanted = wgpu::Features::FLOAT32_FILTERABLE | wgpu::Features::TIMESTAMP_QUERY
        | wgpu::Features::DEPTH32FLOAT_STENCIL8 | wgpu::Features::RG11B10UFLOAT_RENDERABLE
        | wgpu::Features::SHADER_F16 | wgpu::Features::DUAL_SOURCE_BLENDING
        | wgpu::Features::DEPTH_CLIP_CONTROL | wgpu::Features::INDIRECT_FIRST_INSTANCE;
    let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("march-replay"),
        required_features: wanted & adapter.features(),
        required_limits: adapter.limits(),
        ..Default::default()
    }).await.expect("no device");
    (adapter, device, queue)
}

fn wait(device: &wgpu::Device) {
    device.poll(wgpu::PollType::wait_indefinitely()).expect("device poll");
}

/// Read colour attachment 0 back and compare it with what the game itself
/// rendered — a replay that draws a different picture measures a different
/// workload.
fn parity(p: &Pass, device: &wgpu::Device, queue: &wgpu::Queue, png: Option<&Path>) -> String {
    let Some((tex, file, w, h)) = &p.output else { return "\"skipped\"".into() };
    let Some(Obj::Texture(t)) = p.objs.get(tex) else { unreachable!() };
    if t.format() != wgpu::TextureFormat::Rgba32Float { return "\"skipped\"".into(); }
    let (w, h) = (*w, *h);
    let bytes_per_row = (w * 16).div_ceil(256) * 256;
    let staging = device.create_buffer(&wgpu::BufferDescriptor {
        label: None, size: (bytes_per_row * h) as u64,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
    });
    let mut enc = device.create_command_encoder(&Default::default());
    enc.copy_texture_to_buffer(
        t.as_image_copy(),
        wgpu::TexelCopyBufferInfo { buffer: &staging, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(bytes_per_row), rows_per_image: Some(h) } },
        wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
    );
    queue.submit([enc.finish()]);
    staging.slice(..).map_async(wgpu::MapMode::Read, |r| r.expect("map"));
    wait(device);
    let got = staging.slice(..).get_mapped_range().expect("mapped range");
    let want = std::fs::read(file).expect("post blob");
    let f = |b: &[u8], i: usize| f32::from_le_bytes(b[i..i + 4].try_into().unwrap());
    let (mut max, mut sum, mut differing) = (0f32, 0f64, 0u64);
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for y in 0..h as usize {
        for x in 0..(w * 4) as usize {
            let g = f(&got, y * bytes_per_row as usize + x * 4);
            let diff = (g - f(&want, (y * w as usize * 4 + x) * 4)).abs();
            if !(diff <= 1e-4) { differing += 1; }
            if diff.is_finite() { max = max.max(diff); sum += diff as f64; }
            if x % 4 != 3 { rgb.push((255.0 * g.clamp(0.0, 1.0).powf(1.0 / 2.2)) as u8); }
        }
    }
    if let Some(path) = png {
        let mut encoder = png::Encoder::new(std::io::BufWriter::new(std::fs::File::create(path).expect("png")), w, h);
        encoder.set_color(png::ColorType::Rgb);
        encoder.write_header().unwrap().write_image_data(&rgb).unwrap();
    }
    let n = (w * h * 4) as f64;
    format!("{{\"label\":\"{}\",\"maxDiff\":{max},\"meanDiff\":{},\"differingFrac\":{}}}", p.label, sum / n, differing as f64 / n)
}

fn median(v: &[f64]) -> f64 {
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    s[s.len() / 2]
}

fn headless(args: &Args) {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let (adapter, device, queue) = pollster::block_on(open_device(&instance, None));
    let t_load = Instant::now();
    let (replay, _meta) = Replay::load(&args.dir, &args.manifest, &device, &queue, args.unchecked);
    let mut enc = device.create_command_encoder(&Default::default());
    replay.encode(&mut enc);
    queue.submit([enc.finish()]);
    wait(&device);
    let load_ms = t_load.elapsed().as_secs_f64() * 1e3; // includes the shader compile
    let checks: Vec<String> = replay.passes.iter().map(|p| parity(p, &device, &queue, args.png.as_deref())).collect();

    // GPU-side timestamps around every pass copy, beside the wall clock.
    let stamps = device.features().contains(wgpu::Features::TIMESTAMP_QUERY);
    let per_round = args.repeat * replay.passes.len() as u32 * 2;
    let query_set = stamps.then(|| device.create_query_set(&wgpu::QuerySetDescriptor { label: None, ty: wgpu::QueryType::Timestamp, count: per_round }));
    let resolve = device.create_buffer(&wgpu::BufferDescriptor {
        label: None, size: per_round as u64 * 8,
        usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC, mapped_at_creation: false,
    });
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: None, size: per_round as u64 * 8,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
    });
    let period = queue.get_timestamp_period() as f64;

    let round = |timed: bool| -> (f64, f64) {
        let mut enc = device.create_command_encoder(&Default::default());
        let mut q = 0;
        for _ in 0..args.repeat {
            for p in &replay.passes {
                p.encode(&mut enc, query_set.as_ref().filter(|_| timed).map(|qs| (qs, q)));
                q += 2;
            }
        }
        if let (true, Some(qs)) = (timed, &query_set) {
            enc.resolve_query_set(qs, 0..per_round, &resolve, 0);
            enc.copy_buffer_to_buffer(&resolve, 0, &readback, 0, per_round as u64 * 8);
        }
        let buf = enc.finish();
        let t0 = Instant::now();
        let index = queue.submit([buf]);
        device.poll(wgpu::PollType::Wait { submission_index: Some(index), timeout: None }).expect("device poll");
        let wall = t0.elapsed().as_secs_f64() * 1e3 / args.repeat as f64;
        let mut gpu = f64::NAN;
        if timed && query_set.is_some() {
            readback.slice(..).map_async(wgpu::MapMode::Read, |r| r.expect("map"));
            wait(&device);
            {
                let data = readback.slice(..).get_mapped_range().expect("mapped range");
                let t = |i: usize| u64::from_le_bytes(data[i * 8..i * 8 + 8].try_into().unwrap());
                // first begin -> last end: the K copies, back to back
                gpu = t(per_round as usize - 1).wrapping_sub(t(0)) as f64 * period / 1e6 / args.repeat as f64;
            }
            readback.unmap();
        }
        (wall, gpu)
    };
    for _ in 0..5 { round(false); }
    let (mut wall, mut gpu) = (Vec::new(), Vec::new());
    for _ in 0..args.rounds {
        let (w, g) = round(true);
        wall.push(w);
        gpu.push(g);
    }
    let info = adapter.get_info();
    let min = |v: &[f64]| v.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = |v: &[f64]| v.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    println!(
        "{{\"runner\":\"wgpu{}\",\"adapter\":\"{} ({:?})\",\"repeat\":{},\"rounds\":{},\"medianMs\":{:.3},\"minMs\":{:.3},\"maxMs\":{:.3},\"gpuMedianMs\":{:.3},\"gpuMinMs\":{:.3},\"loadMs\":{:.0},\"parity\":[{}]}}",
        if args.unchecked { "-unchecked" } else { "" }, info.name, info.backend, args.repeat, args.rounds,
        median(&wall), min(&wall), max(&wall), median(&gpu), min(&gpu), load_ms, checks.join(","),
    );
}

fn main() {
    let args = parse_args();
    if args.window { window::run(args) } else { headless(&args) }
}
