//! `--window`: the captured march pass in a bare wgpu window.
//!
//! Every frame runs the captured passes once, stretches colour attachment 0
//! onto the swapchain and presents. It is here to be looked at, and to show
//! what a frame costs with a real present on the end of it; the offscreen
//! loop in main.rs is the measurement that matches Chrome's.

use crate::{open_device, Args, Replay};
use std::sync::Arc;
use std::time::Instant;
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::window::{Window, WindowId};

/// Nearest-neighbour stretch of the march target with the same display curve
/// replay.html uses, so the two replays look alike side by side.
const BLIT: &str = "
@group(0) @binding(0) var src: texture_2d<f32>;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return V(vec4f(uv * 2.0 - 1.0, 0.0, 1.0), vec2f(uv.x, 1.0 - uv.y));
}
@fragment fn fs(v: V) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(src));
  let c = textureLoad(src, vec2u(clamp(v.uv * size, vec2f(0.0), size - 1.0)), 0).rgb;
  return vec4f(pow(clamp(c, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)), 1.0);
}";

struct State {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    device: wgpu::Device,
    queue: wgpu::Queue,
    replay: Replay,
    blit: wgpu::RenderPipeline,
    blit_bind: wgpu::BindGroup,
    last: Instant,
    frame_ms: Vec<f64>,
}

struct App {
    args: Args,
    state: Option<State>,
}

impl App {
    fn open(&mut self, el: &ActiveEventLoop) {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let window = Arc::new(el.create_window(Window::default_attributes().with_title("march-replay")).expect("window"));
        let surface = instance.create_surface(window.clone()).expect("surface");
        let (adapter, device, queue) = pollster::block_on(open_device(&instance, Some(&surface)));
        let (replay, _meta) = Replay::load(&self.args.dir, &self.args.manifest, &device, &queue, self.args.unchecked);
        let (w, h) = replay.passes.last().map(|p| p.output_size()).unwrap_or((400, 300));
        let _ = window.request_inner_size(winit::dpi::LogicalSize::new(w * 2, h * 2));
        let size = window.inner_size();
        let mut config = surface.get_default_config(&adapter, size.width.max(1), size.height.max(1)).expect("surface config");
        config.present_mode = if self.args.vsync { wgpu::PresentMode::AutoVsync } else { wgpu::PresentMode::AutoNoVsync };
        surface.configure(&device, &config);

        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: None, source: wgpu::ShaderSource::Wgsl(BLIT.into()) });
        let blit = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: None, layout: None,
            vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
            primitive: Default::default(), depth_stencil: None, multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module, entry_point: Some("fs"), compilation_options: Default::default(),
                targets: &[Some(config.format.into())],
            }),
            multiview_mask: None, cache: None,
        });
        let output = replay.passes.last().and_then(|p| p.output_view()).expect("the capture has no colour attachment to show");
        let blit_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None, layout: &blit.get_bind_group_layout(0),
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&output) }],
        });
        window.request_redraw();
        self.state = Some(State { window, surface, config, device, queue, replay, blit, blit_bind, last: Instant::now(), frame_ms: Vec::new() });
    }
}

impl State {
    fn draw(&mut self) {
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f) | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
            _ => { self.surface.configure(&self.device, &self.config); return; }
        };
        let view = frame.texture.create_view(&Default::default());
        let mut enc = self.device.create_command_encoder(&Default::default());
        self.replay.encode(&mut enc);
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("blit"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view, depth_slice: None, resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None, multiview_mask: None,
            });
            pass.set_pipeline(&self.blit);
            pass.set_bind_group(0, &self.blit_bind, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit([enc.finish()]);
        self.queue.present(frame);

        let now = Instant::now();
        self.frame_ms.push((now - self.last).as_secs_f64() * 1e3);
        self.last = now;
        if self.frame_ms.len() % 60 == 0 {
            let mut recent = self.frame_ms[self.frame_ms.len() - 60..].to_vec();
            recent.sort_by(|a, b| a.partial_cmp(b).unwrap());
            self.window.set_title(&format!("march-replay — {:.1} ms/frame ({:.0} fps)", recent[30], 1e3 / recent[30]));
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, el: &ActiveEventLoop) {
        if self.state.is_none() { self.open(el); }
    }

    fn window_event(&mut self, el: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        let Some(state) = self.state.as_mut() else { return };
        match event {
            WindowEvent::CloseRequested => el.exit(),
            WindowEvent::Resized(size) => {
                state.config.width = size.width.max(1);
                state.config.height = size.height.max(1);
                state.surface.configure(&state.device, &state.config);
            }
            WindowEvent::RedrawRequested => {
                state.draw();
                if self.args.frames > 0 && state.frame_ms.len() as u32 >= self.args.frames {
                    // skip the first frames: the window is still appearing
                    let mut ms = state.frame_ms[state.frame_ms.len().min(10)..].to_vec();
                    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
                    println!(
                        "{{\"runner\":\"wgpu-window{}\",\"vsync\":{},\"frames\":{},\"medianFrameMs\":{:.3},\"p95FrameMs\":{:.3}}}",
                        if self.args.unchecked { "-unchecked" } else { "" }, self.args.vsync, ms.len(),
                        ms[ms.len() / 2], ms[ms.len() * 95 / 100],
                    );
                    el.exit();
                    return;
                }
                state.window.request_redraw();
            }
            _ => {}
        }
    }
}

pub fn run(args: Args) {
    let event_loop = EventLoop::new().expect("event loop");
    event_loop.run_app(&mut App { args, state: None }).expect("event loop");
}
