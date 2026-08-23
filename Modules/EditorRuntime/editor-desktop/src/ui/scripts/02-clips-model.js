function baseMainClips() {
        const base = [];
        const speed = Math.max(0.05, Number(state.audio.speed || 1));
        let source = 0,
          timeline = 0;
        for (const r of state.removals) {
          if (r.start > source + 0.002) {
            base.push({
              sourceStart: source,
              sourceEnd: r.start,
              start: timeline / speed,
              end: (timeline + r.start - source) / speed,
            });
            timeline += r.start - source;
          }
          source = r.end;
        }
        if (source < state.sourceDuration - 0.002)
          base.push({
            sourceStart: source,
            sourceEnd: state.sourceDuration,
            start: timeline / speed,
            end: (timeline + state.sourceDuration - source) / speed,
          });
        const clips = [];
        for (const b of base) {
          const cuts = state.manualCuts
              .filter(
                (c) => c > b.sourceStart + 0.002 && c < b.sourceEnd - 0.002,
              )
              .sort((a, z) => a - z),
            points = [b.sourceStart, ...cuts, b.sourceEnd];
          for (let i = 0; i < points.length - 1; i++) {
            const s = points[i],
              e = points[i + 1],
              start = b.start + (s - b.sourceStart) / speed;
            clips.push({
              id: `v-${s.toFixed(4)}-${e.toFixed(4)}`,
              sourceStart: s,
              sourceEnd: e,
              start,
              end: start + (e - s) / speed,
            });
          }
        }
        return clips;
      }
      function mainClips() {
        const globalOffset = Math.max(0, Number(state.mainTimelineOffset || 0));
        return baseMainClips().map((clip) => {
          const offset = Number(state.mainVideoClipOffsets?.[clip.id] || 0);
          return {
            ...clip,
            start: Math.max(0, clip.start + globalOffset + offset),
            end: Math.max(0, clip.end + globalOffset + offset),
          };
        }).sort((a, b) => a.start - b.start);
      }
      function mainContentEnd() {
        if (!state.video) return 0;
        const videoEnd = mainClips().reduce(
          (end, clip) => Math.max(end, clip.end),
          0,
        );
        if (state.avLinked) return videoEnd;
        return mainAudioClips().reduce(
          (end, clip) => Math.max(end, clip.end),
          videoEnd,
        );
      }
      function retimeTracksForSpeed(nextSpeed) {
        const previous = Math.max(0.05, Number(state.audio.speed || 1));
        const next = clamp(Number(nextSpeed || 1), 0.5, 2);
        if (Math.abs(previous - next) < 0.0001) return;
        const factor = previous / next;
        for (const list of [
          state.videoLayers,
          state.audioAssets,
          state.images,
          state.titles,
          state.captions,
          state.reviewCaptions,
          state.issues,
          state.audioMutes,
        ])
          for (const item of list || []) {
            item.start *= factor;
            item.end *= factor;
          }
        state.audioCuts = (state.audioCuts || []).map((time) => time * factor);
        state.currentTime *= factor;
        state.mainTimelineOffset = Number(state.mainTimelineOffset || 0) * factor;
        state.mainAudioTimelineOffset =
          Number(state.mainAudioTimelineOffset || 0) * factor;
        for (const map of [state.mainVideoClipOffsets, state.mainAudioClipOffsets])
          for (const key of Object.keys(map || {})) map[key] *= factor;
        state.audio.speed = next;
        state.duration = mainContentEnd();
        clampTracksToDuration();
      }
      function baseMainAudioClips() {
        if (state.avLinked) return mainClips();
        const globalOffset = Math.max(
          0,
          Number(state.mainAudioTimelineOffset || 0),
        );
        const packed = buildPackedMainClips(
          Array.isArray(state.mainAudioRemovals) ? state.mainAudioRemovals : state.removals,
          Array.isArray(state.mainAudioManualCuts) ? state.mainAudioManualCuts : state.manualCuts,
          state.sourceDuration,
          state.audio.speed,
        );
        return packed.map((sourceClip) => {
          const offset = Number(state.mainAudioClipOffsets?.[sourceClip.id] || 0);
          return {
            ...sourceClip,
            start: Math.max(0, sourceClip.start + globalOffset + offset),
            end: Math.max(0, sourceClip.end + globalOffset + offset),
          };
        }).sort((left, right) => left.start - right.start);
      }
      function mainAudioClips() {
        if (state.avLinked) return mainClips();
        const result = [];
        for (const sourceClip of baseMainAudioClips()) {
          const start = Number(sourceClip.start || 0);
          const end = Math.max(start, Number(sourceClip.end || start));
          if (end <= start + 0.002) continue;
          const cuts = (state.audioCuts || [])
            .filter((time) => time > start + 0.002 && time < end - 0.002)
            .sort((a, b) => a - b);
          const points = [start, ...cuts, end];
          for (let index = 0; index < points.length - 1; index += 1)
            result.push({
              id: `a-${sourceClip.id}-${points[index].toFixed(4)}-${points[index + 1].toFixed(4)}`,
              start: points[index],
              end: points[index + 1],
              sourceStart:
                sourceClip.sourceStart +
                (points[index] - start) *
                  Math.max(0.05, Number(state.audio.speed || 1)),
              sourceEnd:
                sourceClip.sourceStart +
                (points[index + 1] - start) *
                  Math.max(0.05, Number(state.audio.speed || 1)),
              parentId: sourceClip.id,
            });
        }
        return result;
      }
      function adoptMainAudioMaps(previousClips = []) {
        const previousSettings = { ...(state.mainAudioClipSettings || {}) };
        const previousTracks = { ...(state.mainAudioTrackMap || {}) };
        const nextSettings = {};
        const nextTracks = {};
        for (const next of mainAudioClips()) {
          const previous = previousClips.find((item) => item.id === next.id) ||
            matchClipBySource(next, previousClips);
          if (!previous) continue;
          if (previousSettings[previous.id])
            nextSettings[next.id] = { ...previousSettings[previous.id] };
          if (previousTracks[previous.id]) nextTracks[next.id] = previousTracks[previous.id];
        }
        state.mainAudioClipSettings = nextSettings;
        state.mainAudioTrackMap = nextTracks;
      }
      function prepareIndependentMainAudio() {
        state.mainAudioRemovals = (state.removals || []).map((item) => ({ ...item }));
        state.mainAudioManualCuts = [...(state.manualCuts || [])];
        const rate = Math.max(0.05, Number(state.audio.speed || 1));
        const base = baseMainAudioClips();
        for (const timelineCut of state.audioCuts || []) {
          const clip = base.find(
            (item) => timelineCut > item.start + 0.002 && timelineCut < item.end - 0.002,
          );
          if (!clip) continue;
          state.mainAudioManualCuts.push(
            Number(clip.sourceStart || 0) + (Number(timelineCut) - Number(clip.start)) * rate,
          );
        }
        state.mainAudioManualCuts = state.mainAudioManualCuts
          .map(Number)
          .filter(Number.isFinite)
          .sort((left, right) => left - right)
          .filter((cut, index, list) => index === 0 || cut - list[index - 1] > 0.002);
        state.audioCuts = [];
      }
      