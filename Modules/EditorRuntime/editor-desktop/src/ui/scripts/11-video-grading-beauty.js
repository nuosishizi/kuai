function applyVideoCss() {
        const c = state.colorBypass ? {} : state.color,
          brightness = Math.max(
            0.1,
            1 +
              ((c.exposure || 0) +
                (c.lift || 0) * 0.24 +
                (c.gain || 0) * 0.3 +
                (c.gamma || 0) * 0.35 +
                (c.shadows || 0) * 0.13 +
                (c.highlights || 0) * 0.11 +
                (c.blacks || 0) * 0.08 +
                (c.whites || 0) * 0.1 +
                (c.pivot || 0) * -0.08) /
                78,
          ),
          contrast = Math.max(
            0.1,
            1 +
              ((c.contrast || 0) +
                (c.midtoneDetail || 0) * 0.42 +
                (c.sharpness || 0) * 0.08 -
                (c.fade || 0) * 0.48 +
                (c.gain || 0) * 0.12 -
                (c.lift || 0) * 0.12) /
                72,
          ),
          saturation = Math.max(
            0,
            1 + ((c.saturation || 0) + (c.vibrance || 0) * 0.7) / 70,
          ),
          sepia = Math.abs(c.temperature || 0) / 360,
          rotate =
            (c.hue || 0) * 1.8 +
            (c.tint || 0) * 0.35 -
            (c.temperature || 0) * 0.2;
        const beauty = state.beautyBypass ? {} : state.beauty;
        const smooth = Math.max(0, Number(beauty.smoothing || 0)) / 100;
        const blemish = Math.max(0, Number(beauty.blemish || 0)) / 100;
        const detail = Math.max(0, Number(beauty.texture || 0)) / 100;
        const whitening = Math.max(0, Number(beauty.whitening || 0)) / 100;
        const warmth = Number(beauty.warmth || 0) / 50;
        const brighten = Number(beauty.brighten || 0) / 100;
        const rosy = Number(beauty.rosy || 0) / 100;
        const previewFilter =
          `brightness(${Math.max(0.1, brightness + brighten * 0.08)}) contrast(${Math.max(0.1, contrast)}) saturate(${Math.max(0, saturation)}) sepia(${Math.min(1, sepia + Math.max(0, warmth) * 0.03)}) hue-rotate(${rotate - warmth * 2}deg)`;
        // A lightweight CSS pass is deliberately kept underneath the GPU
        // canvas.  WebKit can reject video-to-WebGL uploads for a local media
        // URL; in that case beauty controls must still change the picture.
        // 美颜失败时宁可显示原片，也不再用全画面 blur/brightness 伪造美颜，避免天空和背景一起变亮变糊。
        const beautyFallback = "";
        const v1 = $("video");
        const v2 = $("videoAlt");
        if (v1) {
          v1.style.filter = `${previewFilter}${beautyFallback}`;
          v1.muted = state.trackVisibility.audio === false;
          applyMediaPlaybackRate(v1);
        }
        if (v2) {
          v2.style.filter = `${previewFilter}${beautyFallback}`;
          v2.muted = state.trackVisibility.audio === false;
          applyMediaPlaybackRate(v2);
        }
        $("beautyPreviewCanvas").style.filter = previewFilter;
        document
          .querySelectorAll(".layer-video")
          .forEach((element) => (element.style.filter = `${previewFilter}${beautyFallback}`));
        $("frame").style.setProperty(
          "--vignette-opacity",
          String(Math.min(0.9, Number(c.vignette || 0) / 105)),
        );
        updateBeautyPreviewState();
      }
      let beautyGL = null, beautyGLUnavailable = false,
        beautyFrameRequest = 0, beautyLastDraw = 0, beauty2DCanvas = null;
      function beautyIsActive() {
        if (state.beautyBypass) return false;
        const beauty = state.beauty || {};
        return ["smoothing", "blemish", "texture", "whitening", "brighten", "warmth", "rosy"]
          .some((key) => Math.abs(Number(beauty[key] || 0)) > .01);
      }
      function compileBeautyShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(gl.getShaderInfoLog(shader) || "Beauty shader compile failed");
        return shader;
      }
      function ensureBeautyGL() {
        if (beautyGL) return beautyGL;
        if (beautyGLUnavailable) return null;
        const canvas = $("beautyPreviewCanvas"), gl = canvas.getContext("webgl", {
          alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false,
          powerPreference: "high-performance",
        });
        if (!gl) { beautyGLUnavailable = true; return null; }
        try {
        const vertex = compileBeautyShader(gl, gl.VERTEX_SHADER,
          `attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)*.5,1.-(p.y+1.)*.5);gl_Position=vec4(p,0.,1.);}`),
          fragment = compileBeautyShader(gl, gl.FRAGMENT_SHADER, `
            precision mediump float;varying vec2 uv;uniform sampler2D image;uniform vec2 texel;
            uniform float smoothness,blemish,detail,whitening,brighten,warmth,rosy;
            float skinMask(vec3 c){
              float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b));
              float warm=smoothstep(.015,.10,c.r-c.g)*smoothstep(-.02,.10,c.g-c.b);
              float chroma=smoothstep(.035,.14,mx-mn);
              float lum=smoothstep(.10,.28,dot(c,vec3(.299,.587,.114)))*(1.-smoothstep(.88,1.,dot(c,vec3(.299,.587,.114))));
              return clamp(warm*chroma*lum,0.,1.);
            }
            void main(){vec3 c=texture2D(image,uv).rgb;float mask=skinMask(c);float r=1.+smoothness*2.0+blemish*2.8;
            vec2 x=vec2(texel.x*r,0.),y=vec2(0.,texel.y*r);vec3 s=c*2.;float w=2.;
            vec3 a=texture2D(image,uv+x).rgb,b=texture2D(image,uv-x).rgb,d=texture2D(image,uv+y).rgb,e=texture2D(image,uv-y).rgb;
            float edge=20.+28.*(1.-blemish),wa=exp(-dot(a-c,a-c)*edge),wb=exp(-dot(b-c,b-c)*edge),wd=exp(-dot(d-c,d-c)*edge),we=exp(-dot(e-c,e-c)*edge);
            s+=a*wa+b*wb+d*wd+e*we;w+=wa+wb+wd+we;vec3 soft=s/w;
            vec3 skin=mix(c,soft,clamp((smoothness*.62+blemish*.44)*mask,0.,.82));skin+=(c-soft)*detail*.55*mask;
            skin=mix(skin,pow(max(skin,vec3(0.)),vec3(.88)),whitening*.48*mask);skin*=1.+brighten*.13*mask;
            skin.r+=(warmth*.030+rosy*.024)*mask;skin.b-=warmth*.020*mask;skin.g-=rosy*.009*mask;
            gl_FragColor=vec4(clamp(skin,0.,1.),1.);}`), program = gl.createProgram();
        gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Beauty shader link failed");
        gl.useProgram(program);
        const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, "p");
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const names = ["texel", "smoothness", "blemish", "detail", "whitening", "brighten", "warmth", "rosy"];
        beautyGL = { gl, texture, uniforms: Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)])) };
        return beautyGL;
        } catch {
          beautyGLUnavailable = true;
          canvas.classList.remove("ready");
          return null;
        }
      }
      function drawBeautyPreview(now = performance.now()) {
        const canvas = $("beautyPreviewCanvas");
        const video = (typeof getActiveVideo === "function") ? getActiveVideo() : $("video");
        if (!beautyIsActive() || !state.video || !video || video.readyState < 2) return;
        if (now - beautyLastDraw < 32) { beautyFrameRequest = requestAnimationFrame(drawBeautyPreview); return; }
        beautyLastDraw = now;
        const engine = ensureBeautyGL();
        if (!engine) {
          // WebKit/CEF can reject direct video->WebGL uploads for local media.
          // Fall back to a small 2D compositor with a skin-color mask instead of
          // making the beauty controls appear dead or applying a global blur.
          drawBeautyPreview2D(canvas, video);
          if (state.playing) beautyFrameRequest = requestAnimationFrame(drawBeautyPreview);
          return;
        }
        const maxSide = 720, vw = video.videoWidth || state.width, vh = video.videoHeight || state.height,
          scale = Math.min(1, maxSide / Math.max(vw, vh)), width = Math.max(2, Math.round(vw * scale)), height = Math.max(2, Math.round(vh * scale));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; engine.gl.viewport(0, 0, width, height); }
        const { gl, texture, uniforms } = engine, beauty = state.beauty || {};
        gl.bindTexture(gl.TEXTURE_2D, texture);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); }
        catch {
          beautyGLUnavailable = true;
          drawBeautyPreview2D(canvas, video);
          if (state.playing) beautyFrameRequest = requestAnimationFrame(drawBeautyPreview);
          return;
        }
        gl.uniform2f(uniforms.texel, 1 / width, 1 / height);
        gl.uniform1f(uniforms.smoothness, clamp(Number(beauty.smoothing || 0) / 100, 0, 1));
        gl.uniform1f(uniforms.blemish, clamp(Number(beauty.blemish || 0) / 100, 0, 1));
        gl.uniform1f(uniforms.detail, clamp(Number(beauty.texture || 0) / 100, 0, 1));
        gl.uniform1f(uniforms.whitening, clamp(Number(beauty.whitening || 0) / 100, 0, 1));
        gl.uniform1f(uniforms.brighten, clamp(Number(beauty.brighten || 0) / 100, 0, 1));
        gl.uniform1f(uniforms.warmth, clamp(Number(beauty.warmth || 0) / 100, -1, 1));
        gl.uniform1f(uniforms.rosy, clamp(Number(beauty.rosy || 0) / 100, 0, 1));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (gl.getError() === gl.NO_ERROR) canvas.classList.add("ready");
        else { beautyGLUnavailable = true; canvas.classList.remove("ready"); }
        if (state.playing) beautyFrameRequest = requestAnimationFrame(drawBeautyPreview);
      }
      function skinProbability(r, g, b) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const warm = clamp((r - g - 3) / 28, 0, 1) * clamp((g - b + 10) / 30, 0, 1);
        const chroma = clamp((mx - mn - 10) / 34, 0, 1);
        const luminance = clamp((lum - 0.10) / 0.16, 0, 1) * clamp((0.96 - lum) / 0.14, 0, 1);
        return clamp(warm * chroma * luminance, 0, 1);
      }
      function drawBeautyPreview2D(canvas, video) {
        try {
          const beauty = state.beauty || {};
          const maxSide = 460, vw = video.videoWidth || state.width, vh = video.videoHeight || state.height;
          const scale = Math.min(1, maxSide / Math.max(vw, vh));
          const width = Math.max(2, Math.round(vw * scale)), height = Math.max(2, Math.round(vh * scale));
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
          const ctx = canvas.getContext("2d", { willReadFrequently: true, alpha: false });
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, width, height);
          const image = ctx.getImageData(0, 0, width, height), data = image.data;
          const whitening = clamp(Number(beauty.whitening || 0) / 100, 0, 1);
          const brighten = clamp(Number(beauty.brighten || 0) / 100, -1, 1);
          const warmth = clamp(Number(beauty.warmth || 0) / 100, -1, 1);
          const rosy = clamp(Number(beauty.rosy || 0) / 100, -1, 1);
          const smoothing = clamp(Number(beauty.smoothing || 0) / 100, 0, 1);
          const blemish = clamp(Number(beauty.blemish || 0) / 100, 0, 1);
          const texture = clamp(Number(beauty.texture || 0) / 100, 0, 1);
          // Color-only pass is intentionally skin-masked: sky/background pixels stay unchanged.
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2], mask = skinProbability(r, g, b);
            if (mask < 0.025) continue;
            const strength = mask * (0.35 + 0.65 * Math.max(whitening, Math.abs(brighten), Math.abs(warmth), Math.abs(rosy), smoothing, blemish));
            let nr = r, ng = g, nb = b;
            const lift = (whitening * 22 + brighten * 18) * strength;
            nr += lift + warmth * 8 * strength + rosy * 7 * strength;
            ng += lift * 0.86 - rosy * 2.0 * strength;
            nb += lift * 0.72 - warmth * 6 * strength;
            const mid = (nr + ng + nb) / 3;
            const soften = clamp((smoothing * 0.20 + blemish * 0.14 - texture * 0.08) * mask, 0, 0.22);
            nr = nr * (1 - soften) + mid * soften;
            ng = ng * (1 - soften) + mid * soften;
            nb = nb * (1 - soften) + mid * soften;
            data[i] = clamp(Math.round(nr), 0, 255);
            data[i + 1] = clamp(Math.round(ng), 0, 255);
            data[i + 2] = clamp(Math.round(nb), 0, 255);
          }
          ctx.putImageData(image, 0, 0);
          canvas.classList.add("ready");
        } catch {
          canvas.classList.remove("ready");
        }
      }

      function updateBeautyPreviewState() {
        const canvas = $("beautyPreviewCanvas");
        const video = (typeof getActiveVideo === "function") ? getActiveVideo() : $("video");
        const active = beautyIsActive();
        canvas.style.display = active ? "block" : "none";
        if (!active || !video) { canvas.classList.remove("ready"); if (beautyFrameRequest) cancelAnimationFrame(beautyFrameRequest); beautyFrameRequest = 0; return; }
        canvas.style.transform = video.style.transform; canvas.style.opacity = video.style.opacity || "1";
        canvas.style.mixBlendMode = video.style.mixBlendMode || "normal";
        if (!beautyFrameRequest) beautyFrameRequest = requestAnimationFrame(drawBeautyPreview);
      }
      