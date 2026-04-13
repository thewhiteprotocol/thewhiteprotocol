"use client";

import React, { FC, useRef, useEffect, useState } from "react";

export interface MilkCrystalCityProps {
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
  vec3 a = vec3(0.92, 0.91, 0.89);
  vec3 b = vec3(0.05, 0.05, 0.06);
  vec3 c = vec3(1.0, 1.0, 0.9);
  vec3 d = vec3(0.0, 0.05, 0.1);
  return a + b * cos(6.28318 * (c*t + d));
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / u_resolution.y;
  
  // Mouse direction - already smoothed from JS
  vec2 mouseDir = (u_mouse - 0.5) * 2.0;
  
  // SLOWER camera movement
  float moveX = mouseDir.x * u_cameraSpeed * u_time * 0.15;  // reduced from 0.5
  float moveZ = u_time * u_cameraSpeed * (1.0 - abs(mouseDir.x) * 0.15);  // reduced from 0.3
  float moveY = mouseDir.y * 0.2;  // reduced from 0.5
  
  vec3 ro = vec3(moveX, moveY, moveZ);
  vec3 rd = normalize(vec3(uv, 1.0));
  
  // SLOWER rotation
  float mx = mouseDir.x * 0.4;  // reduced from 0.8
  float my = mouseDir.y * 0.25;  // reduced from 0.5
  mat3 rotX = mat3(1, 0, 0, 0, cos(my), -sin(my), 0, sin(my), cos(my));
  mat3 rotY = mat3(cos(mx), 0, sin(mx), 0, 1, 0, -sin(mx), 0, cos(mx));
  rd = rotY * rotX * rd;
  
  float dist = rayMarch(ro, rd);
  vec3 col = vec3(0.94, 0.93, 0.91);
  
  if (dist < u_maxDist) {
    vec3 p = ro + rd * dist;
    float idSeed = floor(p.xz / u_tileSize).x * 157.0 + floor(p.xz / u_tileSize).y * 311.0;
    float n = fract(sin(idSeed) * 43758.5453);
    float lines = abs(fract(p.y * 2.0) - 0.5);
    float glow = pow(0.01 / lines, 1.2);
    vec3 lineColor = palette(n + u_time * 0.1);
    col -= lineColor * glow * 0.15;
    col += vec3(1.0) * glow * 0.05;
  }
  
  col = mix(col, vec3(0.96, 0.95, 0.93), smoothstep(0.0, u_maxDist * 0.7, dist));
  col = clamp(col, vec3(0.85), vec3(1.0));
  fragColor = vec4(col, 1.0);
}
`;

const MilkCrystalCity: FC<MilkCrystalCityProps> = ({
  cameraSpeed = 3, tileSize = 2, unionK = 0.5, maxSteps = 80, maxDist = 80, surfDist = 0.001, className = "", ariaLabel = "Milk Crystal City",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const frameId = useRef<number>();
  const mouseTarget = useRef({ x: 0.5, y: 0.5 });  // where mouse actually is
  const mouseSmooth = useRef({ x: 0.5, y: 0.5 });  // smoothed value sent to shader
  const start = useRef<number>(Date.now());

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

    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -1, -1, 1, 1, 1, -1]), gl.STATIC_DRAW);

    const onMouse = (e: MouseEvent) => {
      mouseTarget.current.x = e.clientX / window.innerWidth;
      mouseTarget.current.y = 1.0 - (e.clientY / window.innerHeight);
    };
    window.addEventListener("mousemove", onMouse);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    window.addEventListener("resize", resize);
    resize();

    const render = () => {
      if (error) return;
      
      // SMOOTH interpolation - lerp towards target (0.02 = very smooth, 0.1 = faster)
      const smoothing = 0.03;
      mouseSmooth.current.x += (mouseTarget.current.x - mouseSmooth.current.x) * smoothing;
      mouseSmooth.current.y += (mouseTarget.current.y - mouseSmooth.current.y) * smoothing;
      
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.enableVertexAttribArray(posLoc);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      const now = (Date.now() - start.current) * 0.001;
      gl.uniform2f(resLoc, canvas.width, canvas.height);
      gl.uniform1f(timeLoc, now);
      gl.uniform2f(mouseLoc, mouseSmooth.current.x, mouseSmooth.current.y);  // smoothed!
      gl.uniform1f(speedLoc, cameraSpeed);
      gl.uniform1f(tileLoc, tileSize);
      gl.uniform1f(unionLoc, unionK);
      gl.uniform1i(stepsLoc, maxSteps);
      gl.uniform1f(maxLoc, maxDist);
      gl.uniform1f(surfLoc, surfDist);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frameId.current = requestAnimationFrame(render);
    };
    frameId.current = requestAnimationFrame(render);

    return () => { cancelAnimationFrame(frameId.current!); window.removeEventListener("resize", resize); window.removeEventListener("mousemove", onMouse); };
  }, [cameraSpeed, tileSize, unionK, maxSteps, maxDist, surfDist, error]);

  if (error) return <div className={`fixed inset-0 bg-[#E0E5EC] ${className}`} aria-label={ariaLabel} />;

  return (
    <div role="presentation" aria-label={ariaLabel} className={`fixed inset-0 overflow-hidden pointer-events-none ${className}`} style={{ zIndex: -1 }}>
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
};

export default MilkCrystalCity;
