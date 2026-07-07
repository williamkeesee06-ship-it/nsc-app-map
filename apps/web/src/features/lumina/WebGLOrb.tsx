import { useEffect, useRef } from "react";

interface WebGLOrbProps {
  size?: number;
  rimColor?: string; // Hex color
  glowColor?: string; // Hex color
  pulseSpeed?: number;
}

// Convert Hex string to RGB Vec3
function hexToRgbVec3(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  return [r, g, b];
}

const VERTEX_SHADER = `
  attribute vec2 position;
  varying vec2 v_uv;
  void main() {
    v_uv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec3 u_rim_color;
  uniform vec3 u_glow_color;

  varying vec2 v_uv;

  mat3 rotateX(float a) {
    float c = cos(a), s = sin(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
  }
  mat3 rotateY(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
  }
  mat3 rotateZ(float a) {
    float c = cos(a), s = sin(a);
    return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
  }

  // Noise functions for volumetric core and lightning
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 p = floor(x);
    vec3 f = fract(x);
    f = f*f*(3.0-2.0*f);
    
    return mix(mix(mix(hash(p+vec3(0,0,0)), hash(p+vec3(1,0,0)), f.x),
                   mix(hash(p+vec3(0,1,0)), hash(p+vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(p+vec3(0,0,1)), hash(p+vec3(1,0,1)), f.x),
                   mix(hash(p+vec3(0,1,1)), hash(p+vec3(1,1,1)), f.x), f.y), f.z);
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    vec3 shift = vec3(100.0);
    for (int i = 0; i < 4; ++i) {
      v += a * noise(p);
      p = p * 2.0 + shift;
      a *= 0.5;
    }
    return v;
  }

  // SDF of Torus
  float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
  }

  // Map the scene: tori/rings
  float map(vec3 p, out int hitObj, out vec3 ringColor) {
    float d = 1e10;
    hitObj = 0;
    ringColor = vec3(0.0);
    
    // Ring 1 (Gold, horizontal-oblique)
    vec3 p1 = rotateX(u_time * 0.45) * rotateY(u_time * 0.2 + 0.6) * p;
    float r1 = sdTorus(p1, vec2(0.92, 0.045));
    if (r1 < d) {
      d = r1;
      hitObj = 1;
      ringColor = vec3(0.9, 0.72, 0.23); // Polished Golden
    }
    
    // Ring 2 (Bronze/Rose Gold, vertical-oblique)
    vec3 p2 = rotateY(-u_time * 0.55) * rotateZ(u_time * 0.25 - 0.4) * p;
    float r2 = sdTorus(p2, vec2(0.92, 0.045));
    if (r2 < d) {
      d = r2;
      hitObj = 2;
      ringColor = vec3(0.82, 0.52, 0.32); // Brushed Bronze/Rose Gold
    }
    
    // Ring 3 (Silver/White, oblique)
    vec3 p3 = rotateX(1.1) * rotateZ(u_time * 0.3) * rotateY(-u_time * 0.15) * p;
    float r3 = sdTorus(p3, vec2(0.92, 0.03));
    if (r3 < d) {
      d = r3;
      hitObj = 3;
      ringColor = vec3(0.95, 0.95, 1.0); // Chrome/Silver
    }
    
    return d;
  }

  // Calculate normal for rings
  vec3 calcNormal(vec3 p) {
    int hitObj;
    vec3 rc;
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
      map(p + e.xyy, hitObj, rc) - map(p - e.xyy, hitObj, rc),
      map(p + e.yxy, hitObj, rc) - map(p - e.yxy, hitObj, rc),
      map(p + e.yyx, hitObj, rc) - map(p - e.yyx, hitObj, rc)
    ));
  }

  void main() {
    // Normalise UV coordinates
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
    
    // Camera setup
    vec3 ro = vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(vec3(uv, -1.6));
    
    // Raymarch loop
    float t = 0.0;
    int hitObj = 0;
    vec3 ringColor = vec3(0.0);
    vec3 p;
    
    bool hit = false;
    for (int i = 0; i < 48; ++i) {
      p = ro + rd * t;
      float d = map(p, hitObj, ringColor);
      if (d < 0.001) {
        hit = true;
        break;
      }
      if (t > 4.5) break;
      t += d;
    }
    
    // Samples volumetric gas density along the ray inside the core sphere
    float coreDist = 0.70;
    float accum = 0.0;
    vec3 coreColor = vec3(0.0);
    
    float stepSize = 0.06;
    for (float d_sample = 1.0; d_sample < 3.2; d_sample += 0.06) {
      vec3 sp = ro + rd * d_sample;
      float distToCenter = length(sp);
      if (distToCenter < coreDist) {
        float d_density = (coreDist - distToCenter) / coreDist;
        
        // Dynamic noise swirl animation
        vec3 np = sp * 3.0;
        np.x += sin(u_time * 1.6 + sp.z * 2.5) * 0.35;
        np.y += cos(u_time * 1.3 + sp.x * 2.5) * 0.35;
        np.z += u_time * 0.8;
        
        float n = fbm(np);
        float val = d_density * (n * 1.8 + 0.15);
        accum += val * stepSize * 5.0;
        
        // Swirling mix gradient
        vec3 mixCol = mix(u_glow_color, u_rim_color, distToCenter / coreDist);
        mixCol = mix(mixCol, vec3(0.6, 0.15, 0.9), sin(u_time * 1.0 + distToCenter * 5.0) * 0.5 + 0.5);
        
        coreColor += mixCol * val * stepSize * 7.5;
      }
    }
    
    vec3 col = coreColor;
    
    // Ring shading
    if (hit) {
      vec3 n = calcNormal(p);
      vec3 lPos = vec3(2.5, 4.0, 3.5);
      vec3 lDir = normalize(lPos - p);
      vec3 vDir = normalize(ro - p);
      vec3 hDir = normalize(lDir + vDir);
      
      float amb = 0.25;
      float dif = max(0.0, dot(n, lDir));
      
      // Sophisticated metallic specular highlights
      float spec = pow(max(0.0, dot(n, hDir)), 60.0) * 3.5;
      
      vec3 ringShaded = ringColor * (amb + dif * 0.75) + vec3(1.0) * spec;
      
      // Light reflection bleeding from the core onto inner ring borders
      float coreReflect = max(0.0, dot(n, -normalize(p)));
      ringShaded += u_rim_color * coreReflect * 0.8;
      
      col = mix(col, ringShaded, 0.95);
    }
    
    // Crackling lightning / plasma arcs
    float rVal = length(uv);
    if (rVal < 0.9) {
      float angle = atan(uv.y, uv.x);
      float lightningNoise = fbm(vec3(uv * 14.0, u_time * 4.5));
      float distToLightning = abs(rVal - 0.70 - (lightningNoise - 0.5) * 0.16);
      
      // High-frequency flashing
      float isFlashed = step(0.91, sin(u_time * 9.0 + angle * 4.0));
      if (distToLightning < 0.0075 && isFlashed > 0.5) {
        vec3 lightningColor = mix(vec3(1.0), u_rim_color, 0.5);
        col += lightningColor * (0.0075 / (distToLightning + 0.0015)) * 0.65;
      }
    }
    
    col = clamp(col, 0.0, 1.0);
    
    // Soft vignette/alpha edge
    float alpha = 1.0 - smoothstep(0.92, 0.98, length(uv));
    gl_FragColor = vec4(col, alpha);
  }
`;

export default function WebGLOrb({
  size = 100,
  rimColor = "#00F0FF",
  glowColor = "#7000FF",
  pulseSpeed = 1.0,
}: WebGLOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false });
    if (!gl) {
      console.warn("WebGL not supported, falling back.");
      return;
    }

    // Compile Shader
    const compileShader = (source: string, type: number) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("Shader compilation error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compileShader(VERTEX_SHADER, gl.VERTEX_SHADER);
    const fs = compileShader(FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Program linking error:", gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    // Setup buffer
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    // Uniforms
    const uResolution = gl.getUniformLocation(program, "u_resolution");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uRimColor = gl.getUniformLocation(program, "u_rim_color");
    const uGlowColor = gl.getUniformLocation(program, "u_glow_color");

    let animationId = 0;
    const startTime = Date.now();

    const render = () => {
      if (!canvas || !gl) return;

      // Update resolution/viewport if needed
      if (canvas.width !== size || canvas.height !== size) {
        canvas.width = size;
        canvas.height = size;
        gl.viewport(0, 0, size, size);
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);

      // Set Uniforms
      gl.uniform2f(uResolution, size, size);
      gl.uniform1f(uTime, ((Date.now() - startTime) / 1000) * pulseSpeed);

      const [rr, rg, rb] = hexToRgbVec3(rimColor);
      gl.uniform3f(uRimColor, rr, rg, rb);

      const [gr, gg, gb] = hexToRgbVec3(glowColor);
      gl.uniform3f(uGlowColor, gr, gg, gb);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [size, rimColor, glowColor, pulseSpeed]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: size,
        height: size,
        pointerEvents: "none",
        display: "block",
      }}
    />
  );
}
