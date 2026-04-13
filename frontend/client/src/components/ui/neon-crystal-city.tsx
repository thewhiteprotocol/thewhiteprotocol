"use client";

import React, { FC, useRef, useEffect, useState } from "react";

export interface NeonCrystalCityProps {
  cameraSpeed?: number;
  tileSize?: number;
  unionK?: number;
  maxSteps?: number;
  maxDist?: number;
  surfDist?: number;
  className?: string;
  ariaLabel?: string;
}

const vsSource = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fsSource = `#version 300 es
precision highp float;

uniform vec2  u_resolution;
uniform float u_time;
uniform vec2  u_mouse;
uniform float u_cameraSpeed;
uniform float u_tileSize;
uniform float u_unionK;
uniform int   u_maxSteps;
uniform float u_maxDist;
uniform float u_surfDist;

// Camera state passed from JS
uniform vec3  u_camPos;
uniform float u_camYaw;
uniform float u_camPitch;

out vec4 fragColor;

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float opSmoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5*(d2 - d1)/k, 0.0, 1.0);
  return mix(d2, d1, h) - k*h*(1.0 - h);
}

float getDist(vec3 p) {
  vec2 id = floor(p.xz / u_tileSize);
  p.xz = mod(p.xz, u_tileSize) - u_tileSize*0.5;
  float n = fract(sin(dot(id, vec2(12.9898,78.233))) * 43758.5453);
  float h = 1.0 + n * 4.0;
  float b = sdBox(p - vec3(0.0, h - 1.0, 0.0), vec3(0.4, h, 0.4));
  if (n > 0.8) {
    float s = length(p - vec3(0.0, h*2.0, 0.0)) - 0.5;
    b = opSmoothUnion(b, s, u_unionK);
  }
  float ground = p.y + 1.0;
  return min(b, ground);
}

float rayMarch(vec3 ro, vec3 rd) {
  float dist = 0.0;
  for (int i = 0; i < u_maxSteps; i++) {
    vec3 pos = ro + rd * dist;
    float dS = getDist(pos);
    dist += dS;
    if (dist > u_maxDist || abs(dS) < u_surfDist) break;
  }
  return dist;
}

vec3 palette(float t) {
  vec3 a = vec3(0.5, 0.5, 0.5);
  vec3 b = vec3(0.5, 0.5, 0.5);
  vec3 c = vec3(1.0, 0.7, 0.4);
  vec3 d = vec3(0.0, 0.15, 0.2);
  return a + b * cos(6.28318 * (c*t + d));
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / u_resolution.y;

  // Camera from JS — full FPS control
  vec3 ro = u_camPos;
  vec3 rd = normalize(vec3(uv, 1.0));

  // Mouse adds subtle look offset on top of keyboard yaw/pitch
  vec2 mouseDir = (u_mouse - 0.5) * 2.0;
  float yaw   = u_camYaw   + mouseDir.x * 0.3;
  float pitch = u_camPitch + mouseDir.y * 0.2;

  // Clamp pitch so you can't flip upside down
  pitch = clamp(pitch, -1.2, 1.2);

  mat3 rotX = mat3(1, 0, 0, 0, cos(pitch), -sin(pitch), 0, sin(pitch), cos(pitch));
  mat3 rotY = mat3(cos(yaw), 0, sin(yaw), 0, 1, 0, -sin(yaw), 0, cos(yaw));
  rd = rotY * rotX * rd;

  float dist = rayMarch(ro, rd);
  vec3 col = vec3(0.0);

  if (dist < u_maxDist) {
    vec3 p = ro + rd * dist;
    float idSeed = floor(p.xz / u_tileSize).x * 157.0 + floor(p.xz / u_tileSize).y * 311.0;
    float n = fract(sin(idSeed) * 43758.5453);
    float lines = abs(fract(p.y * 2.0) - 0.5);
    float glow = pow(0.01 / lines, 1.5);
    col += palette(n + u_time * 0.1) * glow;
  }

  col = mix(col, vec3(0.02, 0.01, 0.05), smoothstep(0.0, u_maxDist * 0.7, dist));

  fragColor = vec4(col, 1.0);
}
`;

const NeonCrystalCity: FC<NeonCrystalCityProps> = ({
  cameraSpeed = 3, tileSize = 2, unionK = 0.5, maxSteps = 80, maxDist = 80, surfDist = 0.001, className = "", ariaLabel = "Neon Crystal City",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(true);
  const frameId = useRef<number>();
  const mouseTarget = useRef({ x: 0.5, y: 0.5 });
  const mouseSmooth = useRef({ x: 0.5, y: 0.5 });
  const start = useRef<number>(Date.now());

  // FPS camera state
  const cam = useRef({
    x: 0, y: 0, z: 0,
    yaw: 0, pitch: 0,
    yawSmooth: 0, pitchSmooth: 0,
    xSmooth: 0, ySmooth: 0, zSmooth: 0,
  });

  // Keys currently held
  const keys = useRef<Set<string>>(new Set());
  const showHintRef = useRef(showHint);
  showHintRef.current = showHint;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = (canvas.getContext("webgl2") as WebGL2RenderingContext) || (canvas.getContext("webgl") as WebGLRenderingContext);
    if (!gl) { setError("WebGL not supported"); return; }

    const compileShader = (type: GLenum, src: string): WebGLShader | null => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(sh)); setError("Shader error"); return null; }
      return sh;
    };

    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { setError("Link error"); return; }

    const posLoc = gl.getAttribLocation(prog, "a_position");
    const resLoc = gl.getUniformLocation(prog, "u_resolution")!;
    const timeLoc = gl.getUniformLocation(prog, "u_time")!;
    const mouseLoc = gl.getUniformLocation(prog, "u_mouse")!;
    const speedLoc = gl.getUniformLocation(prog, "u_cameraSpeed")!;
    const tileLoc = gl.getUniformLocation(prog, "u_tileSize")!;
    const unionLoc = gl.getUniformLocation(prog, "u_unionK")!;
    const stepsLoc = gl.getUniformLocation(prog, "u_maxSteps")!;
    const maxLoc = gl.getUniformLocation(prog, "u_maxDist")!;
    const surfLoc = gl.getUniformLocation(prog, "u_surfDist")!;
    const camPosLoc = gl.getUniformLocation(prog, "u_camPos")!;
    const camYawLoc = gl.getUniformLocation(prog, "u_camYaw")!;
    const camPitchLoc = gl.getUniformLocation(prog, "u_camPitch")!;

    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);

    // Mouse — normalized 0..1 with smooth lerp
    const onMouse = (e: MouseEvent) => {
      mouseTarget.current.x = e.clientX / window.innerWidth;
      mouseTarget.current.y = 1.0 - (e.clientY / window.innerHeight);
    };
    window.addEventListener("mousemove", onMouse);

    // Keyboard
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keys.current.add(key === " " ? " " : key);
      if (showHintRef.current) setShowHint(false);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keys.current.delete(key === " " ? " " : key);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    window.addEventListener("resize", resize);
    resize();

    let lastTime = Date.now();

    const render = () => {
      if (error) return;

      const now = Date.now();
      const dt = Math.min((now - lastTime) * 0.001, 0.05);
      lastTime = now;

      const k = keys.current;
      const c = cam.current;
      const turnSpeed = 1.8;
      const moveSpeed = cameraSpeed * 1.5;
      const boost = k.has(" ") ? 2.5 : 1.0;

      // ─── Turning (arrows or Q/E) ───
      if (k.has("arrowleft") || k.has("q"))  c.yaw -= turnSpeed * dt;
      if (k.has("arrowright") || k.has("e")) c.yaw += turnSpeed * dt;
      if (k.has("arrowup"))                  c.pitch += turnSpeed * 0.6 * dt;
      if (k.has("arrowdown"))                c.pitch -= turnSpeed * 0.6 * dt;
      c.pitch = Math.max(-1.2, Math.min(1.2, c.pitch));

      // ─── Movement (WASD) relative to heading ───
      const fwdX = Math.sin(c.yaw);
      const fwdZ = Math.cos(c.yaw);
      const rightX = Math.cos(c.yaw);
      const rightZ = -Math.sin(c.yaw);

      if (k.has("w")) { c.x += fwdX * moveSpeed * boost * dt; c.z += fwdZ * moveSpeed * boost * dt; }
      if (k.has("s")) { c.x -= fwdX * moveSpeed * boost * dt; c.z -= fwdZ * moveSpeed * boost * dt; }
      if (k.has("a")) { c.x -= rightX * moveSpeed * boost * dt; c.z -= rightZ * moveSpeed * boost * dt; }
      if (k.has("d")) { c.x += rightX * moveSpeed * boost * dt; c.z += rightZ * moveSpeed * boost * dt; }

      // Auto-drift forward when idle
      if (!k.has("w") && !k.has("s") && !k.has("a") && !k.has("d")) {
        c.x += fwdX * cameraSpeed * 0.4 * dt;
        c.z += fwdZ * cameraSpeed * 0.4 * dt;
      }

      // ─── Smooth interpolation ───
      const posLerp = 0.08;
      const rotLerp = 0.1;
      c.xSmooth += (c.x - c.xSmooth) * posLerp;
      c.ySmooth += (c.y - c.ySmooth) * posLerp;
      c.zSmooth += (c.z - c.zSmooth) * posLerp;
      c.yawSmooth += (c.yaw - c.yawSmooth) * rotLerp;
      c.pitchSmooth += (c.pitch - c.pitchSmooth) * rotLerp;

      const mSmooth = 0.03;
      mouseSmooth.current.x += (mouseTarget.current.x - mouseSmooth.current.x) * mSmooth;
      mouseSmooth.current.y += (mouseTarget.current.y - mouseSmooth.current.y) * mSmooth;

      // ─── Render ───
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.enableVertexAttribArray(posLoc);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      const elapsed = (Date.now() - start.current) * 0.001;
      gl.uniform2f(resLoc, canvas.width, canvas.height);
      gl.uniform1f(timeLoc, elapsed);
      gl.uniform2f(mouseLoc, mouseSmooth.current.x, mouseSmooth.current.y);
      gl.uniform1f(speedLoc, cameraSpeed);
      gl.uniform1f(tileLoc, tileSize);
      gl.uniform1f(unionLoc, unionK);
      gl.uniform1i(stepsLoc, maxSteps);
      gl.uniform1f(maxLoc, maxDist);
      gl.uniform1f(surfLoc, surfDist);
      gl.uniform3f(camPosLoc, c.xSmooth, c.ySmooth, c.zSmooth);
      gl.uniform1f(camYawLoc, c.yawSmooth);
      gl.uniform1f(camPitchLoc, c.pitchSmooth);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frameId.current = requestAnimationFrame(render);
    };
    frameId.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameId.current!);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [cameraSpeed, tileSize, unionK, maxSteps, maxDist, surfDist, error]);

  if (error) {
    return <div className={`fixed inset-0 bg-[#090B13] ${className}`} aria-label={ariaLabel} />;
  }

  return (
    <div role="presentation" aria-label={ariaLabel} className={`fixed inset-0 overflow-hidden pointer-events-none ${className}`} style={{ zIndex: -1 }}>
      <canvas ref={canvasRef} className="block w-full h-full" />
      {showHint && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2.5 bg-white/[0.04] backdrop-blur-md rounded-xl border border-white/[0.06] pointer-events-auto animate-pulse">
          <div className="flex gap-1">
            <kbd className="px-2 py-1 text-[11px] font-mono font-bold text-cyan-400 bg-white/[0.06] rounded border border-white/[0.08]">W</kbd>
            <kbd className="px-2 py-1 text-[11px] font-mono font-bold text-cyan-400 bg-white/[0.06] rounded border border-white/[0.08]">A</kbd>
            <kbd className="px-2 py-1 text-[11px] font-mono font-bold text-cyan-400 bg-white/[0.06] rounded border border-white/[0.08]">S</kbd>
            <kbd className="px-2 py-1 text-[11px] font-mono font-bold text-cyan-400 bg-white/[0.06] rounded border border-white/[0.08]">D</kbd>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">move</span>
          <div className="w-px h-4 bg-white/[0.08]"></div>
          <div className="flex gap-1">
            <kbd className="px-2 py-1 text-[11px] font-mono font-bold text-cyan-400 bg-white/[0.06] rounded border border-white/[0.08]">←</kbd>
            <kbd className="px-2 py-1 text-[11px] font-mono font-bold text-cyan-400 bg-white/[0.06] rounded border border-white/[0.08]">→</kbd>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">look</span>
          <div className="w-px h-4 bg-white/[0.08]"></div>
          <kbd className="px-2.5 py-1 text-[11px] font-mono font-bold text-cyan-400 bg-white/[0.06] rounded border border-white/[0.08]">SPACE</kbd>
          <span className="text-[11px] text-slate-400 font-medium">boost</span>
        </div>
      )}
    </div>
  );
};

export default NeonCrystalCity;