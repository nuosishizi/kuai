function updateFrameSize(force = false) {
        const stage = $("stage"),
          maxH = Math.max(230, stage.clientHeight - 45),
          maxW = Math.max(260, stage.clientWidth - 90),
          ratio = state.width / state.height;
        let h = maxH,
          w = h * ratio;
        if (w > maxW) {
          w = maxW;
          h = w / ratio;
        }
        const frame = $("frame");
        frame.style.width = `${w}px`;
        frame.style.height = `${h}px`;
        frame.style.transform = `scale(${state.canvasZoom || 1})`;
        frame.style.transformOrigin = "center center";
        if (force) renderPreviewObjects(true);
        else updatePreviewTransformOnly();
      }
      function setRatio(ratio) {
        state.ratio = ratio;
        if (ratio === "9:16") {
          state.width = 1080;
          state.height = 1920;
          $("resolution").innerHTML =
            '<option value="1080x1920">1080×1920</option><option value="1440x2560">1440×2560</option><option value="2160x3840">2160×3840</option>';
        } else {
          state.width = 1920;
          state.height = 1080;
          $("resolution").innerHTML =
            '<option value="1920x1080">1920×1080</option><option value="2560x1440">2560×1440</option><option value="3840x2160">3840×2160</option>';
        }
        if (!state.initializing) {
          updateFrameSize(false);
          renderAll();
        }
      }
      function previewIsFullscreen() {
        const stage = $("stage");
        return document.fullscreenElement === stage || document.webkitFullscreenElement === stage ||
          stage?.classList.contains("preview-fullscreen");
      }
      function syncPreviewFullscreen() {
        const active = previewIsFullscreen();
        $("stage")?.classList.toggle(
          "preview-fullscreen",
          active && !document.fullscreenElement && !document.webkitFullscreenElement,
        );
        if ($("previewFullscreen"))
          $("previewFullscreen").textContent = active ? "退出全屏" : "全屏预览";
        requestAnimationFrame(() => updateFrameSize(true));
      }
      async function togglePreviewFullscreen() {
        const stage = $("stage");
        if (!stage) return;
        try {
          if (document.fullscreenElement || document.webkitFullscreenElement) {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
          } else if (stage.classList.contains("preview-fullscreen")) {
            stage.classList.remove("preview-fullscreen");
          } else if (stage.requestFullscreen) {
            await stage.requestFullscreen();
          } else if (stage.webkitRequestFullscreen) {
            stage.webkitRequestFullscreen();
          } else {
            stage.classList.add("preview-fullscreen");
          }
        } catch {
          stage.classList.toggle("preview-fullscreen");
        }
        syncPreviewFullscreen();
      }
      document.addEventListener("fullscreenchange", syncPreviewFullscreen);
      document.addEventListener("webkitfullscreenchange", syncPreviewFullscreen);
      function applyLayout() {
        const layout = state.layout || {};
        const sideMax = Math.max(
            300,
            Math.min(440, innerWidth - 280 - 330 - 10),
          ),
          side = clamp(Number(layout.side || 310), 300, sideMax),
          inspectorMax = Math.max(
            280,
            Math.min(420, innerWidth - side - 330 - 10),
          );
        layout.side = side;
        layout.inspector = clamp(
          Number(layout.inspector || 300),
          280,
          inspectorMax,
        );
        document.documentElement.style.setProperty(
          "--side",
          `${layout.side}px`,
        );
        document.documentElement.style.setProperty(
          "--inspector",
          `${layout.inspector}px`,
        );
        const totalTrackHeight = (state.trackOrder || []).reduce(
          (acc, key) => acc + Math.max(40, Number(state.trackHeights?.[key] || 56)),
          0,
        );
        const minTimelineH = Math.max(280, totalTrackHeight + 96);
        const timelineTarget = Math.max(minTimelineH, Number(layout.timeline || 350));
        document.documentElement.style.setProperty(
          "--timeline",
          `${clamp(timelineTarget, 220, Math.max(minTimelineH, innerHeight - 160))}px`,
        );
        document.documentElement.style.setProperty(
          "--track-label-width",
          `${clamp(Number(layout.trackLabel || 175), 160, 360)}px`,
        );
      }
      let layoutDrag = null;
      function beginLayoutResize(event, kind) {
        const layout = state.layout || (state.layout = {});
        layoutDrag = {
          pointer: event.pointerId,
          kind,
          x: event.clientX,
          y: event.clientY,
          value: Number(layout[kind] || {
            side: 310,
            inspector: 300,
            timeline: 270,
            trackLabel: 132,
          }[kind]),
        };
        event.currentTarget.classList.add("dragging");
        event.preventDefault();
      }
      $("leftPanelResizer").onpointerdown = (event) =>
        beginLayoutResize(event, "side");
      $("rightPanelResizer").onpointerdown = (event) =>
        beginLayoutResize(event, "inspector");
      $("timelineResizer").onpointerdown = (event) =>
        beginLayoutResize(event, "timeline");
      $("trackLabelResizer").onpointerdown = (event) =>
        beginLayoutResize(event, "trackLabel");
      window.addEventListener("pointermove", (event) => {
        if (!layoutDrag || layoutDrag.pointer !== event.pointerId) return;
        const deltaX = event.clientX - layoutDrag.x,
          deltaY = event.clientY - layoutDrag.y;
        if (layoutDrag.kind === "side")
          state.layout.side = layoutDrag.value + deltaX;
        if (layoutDrag.kind === "inspector")
          state.layout.inspector = layoutDrag.value - deltaX;
        if (layoutDrag.kind === "timeline") {
          const totalTrackHeight = (state.trackOrder || []).reduce(
            (acc, key) => acc + Math.max(40, Number(state.trackHeights?.[key] || 56)),
            0,
          );
          const minH = Math.max(280, totalTrackHeight + 96);
          state.layout.timeline = clamp(layoutDrag.value - deltaY, minH, Math.max(minH, innerHeight - 160));
        }
        if (layoutDrag.kind === "trackLabel")
          state.layout.trackLabel = clamp(layoutDrag.value + deltaX, 92, 360);
        if (!layoutDrag.framePending)
          layoutDrag.framePending = requestAnimationFrame(() => {
            if (!layoutDrag) return;
            layoutDrag.framePending = 0;
            applyLayout();
          });
      });
      window.addEventListener("pointerup", (event) => {
        if (!layoutDrag || layoutDrag.pointer !== event.pointerId) return;
        if (layoutDrag.framePending) cancelAnimationFrame(layoutDrag.framePending);
        applyLayout();
        document.querySelectorAll(".dragging").forEach((item) => item.classList.remove("dragging"));
        layoutDrag = null;
        updateFrameSize(true);
        queueAutosave();
      });
      