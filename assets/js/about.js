(() => {
  "use strict";

  window.atContent.load("about/content.json").then(content => {
    const statement = document.querySelector(".about-statement");
    const details = document.querySelector(".about-details");
    const wordmark = document.getElementById("about-scaled-text");
    const render = () => {
      const y = window.scrollY;
      const lang = window.atContent.lang();
      statement.textContent = content.statement[lang];
      statement.style.whiteSpace = "pre-line";
      wordmark.replaceChildren(...Array.from(content.title[lang]).flatMap((letter, index) => index ? [document.createElement("br"), document.createTextNode(letter)] : [document.createTextNode(letter)]));
      const columns = document.createDocumentFragment();
      content.columns.forEach(column => {
        const wrapper = document.createElement("div");
        wrapper.className = "about-column";
        column.sections.forEach(section => {
          const heading = document.createElement("h2");
          heading.textContent = section.heading[lang].toLocaleLowerCase(lang).replace(/^\p{L}/u, letter => letter.toLocaleUpperCase(lang));
          const body = document.createElement("p");
          section.items.forEach((item, index) => {
            if (index) body.append(document.createElement("br"));
            const text = item.text[lang];
            if (item.href) {
              const link = document.createElement("a");
              link.href = item.href;
              link.textContent = text;
              if (/^https?:/.test(item.href)) { link.target = "_blank"; link.rel = "noopener noreferrer"; }
              body.append(link);
            } else body.append(document.createTextNode(text));
          });
          wrapper.append(heading, body);
        });
        columns.append(wrapper);
      });
      details.replaceChildren(columns);
      requestAnimationFrame(() => { window.dispatchEvent(new Event("resize")); window.scrollTo(0, y); });
    };
    render();
    document.addEventListener("at:language", render);
  }).catch(error => console.error("About content", error));

  const textElement = document.getElementById("about-scaled-text");

  if (textElement) {
    const stage = textElement.closest(".about-title-stage");
    const minScale = 1;
    const maxScale = 30.3;
    const touchViewport = window.matchMedia("(max-width: 1032px)");
    const tabletViewport = window.matchMedia("(min-width: 441px) and (max-width: 1032px)");
    const mobileViewport = window.matchMedia("(max-width: 440px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const orientationEvent = window.DeviceOrientationEvent;
    const lens = {
      sensitivity: 2.2 * Math.PI / 180,
      deadZone: 0.12 * Math.PI / 180,
      maxCompression: 0.74,
      minSpread: 0.13,
      maxSpread: 0.34,
      travel: 0.36,
      smoothing: 0.85 // Fraction of the newest sample.
    };
    const debug = new URLSearchParams(window.location.search).get("debug") === "1"
      ? document.createElement("pre")
      : null;
    if (debug) {
      debug.id = "about-orientation-debug";
      debug.style.cssText = "position:fixed;z-index:10000;left:8px;bottom:28px;max-width:calc(100% - 16px);margin:0;padding:8px;background:#111;color:#fff;font:12px/1.4 monospace;white-space:pre-wrap;pointer-events:none";
      document.body.append(debug);
    }
    let permission = "unsupported";
    if (orientationEvent) {
      permission = typeof orientationEvent.requestPermission === "function" ? "prompt" : "automatic";
    }
    let listening = false;
    let eventCount = 0;
    let rawAngles = "alpha: —  beta: —  gamma: —";
    let heading = 0;
    let headingOffset = 0;
    let hasHeading = false;
    let calibration = null;
    let orientation = null;
    let lensFrame = 0;
    let glyphs = [];
    let lastPointerX = null;
    let currentScale = 1;
    let touchMaxScale = maxScale;
    let naturalWidth = 1;
    let scaleFrame = 0;

    function setScale(scale) {
      currentScale = scale;
      textElement.style.transform = `scaleX(${scale.toFixed(3)})`;
    }

    function updateDebug() {
      if (!debug) return;
      const mode = orientation ? "orientation" : touchViewport.matches ? "scroll" : "pointer";
      debug.textContent = [
        `Viewport: ${document.documentElement.clientWidth}px (≤440px: ${mobileViewport.matches ? "yes" : "no"})`,
        `Secure context: ${window.isSecureContext ? "yes" : "no"}`,
        `Permission: ${permission}`,
        `Listener: ${listening ? "on" : "off"}  Events: ${eventCount}`,
        rawAngles,
        `Mode: ${mode}`
      ].join("\n");
    }

    function sampleOrientation({ alpha, beta, gamma }) {
      if (debug) {
        eventCount += 1;
        rawAngles = `alpha: ${alpha}  beta: ${beta}  gamma: ${gamma}`;
      }
      if (!Number.isFinite(beta) || !Number.isFinite(gamma)) {
        updateDebug();
        return;
      }
      // Hold the last heading during a dropout and align the first returning reading to it.
      if (Number.isFinite(alpha)) {
        if (!hasHeading && calibration) headingOffset = heading - alpha;
        heading = alpha + headingOffset;
        hasHeading = true;
      } else {
        hasHeading = false;
      }
      // DeviceOrientation uses intrinsic Z-X′-Y″ rotations. Convert to a unit quaternion first.
      const halfDegrees = Math.PI / 360;
      const [z, x, y] = [heading, beta, gamma].map(angle => angle * halfDegrees);
      const [cz, cx, cy] = [Math.cos(z), Math.cos(x), Math.cos(y)];
      const [sz, sx, sy] = [Math.sin(z), Math.sin(x), Math.sin(y)];
      const sample = [
        cz * cx * cy - sz * sx * sy,
        cz * sx * cy - sz * cx * sy,
        cz * cx * sy + sz * sx * cy,
        sz * cx * cy + cz * sx * sy
      ];
      if (!calibration) {
        calibration = sample;
        orientation = sample;
        // Keep the current title width when the sensor takes over from scroll.
        cancelAnimationFrame(scaleFrame);
        scaleFrame = 0;
      } else {
        // q and -q encode the same pose. Keep samples in the same hemisphere before blending.
        const dot = orientation.reduce((sum, value, index) => sum + value * sample[index], 0);
        const sign = dot < 0 ? -1 : 1;
        const blended = orientation.map((value, index) => value + lens.smoothing * (sign * sample[index] - value));
        const length = Math.hypot(...blended);
        orientation = blended.map(value => value / length);
      }
      if (!lensFrame) lensFrame = requestAnimationFrame(renderLens);
      updateDebug();
    }

    function renderLens() {
      lensFrame = 0;
      if (!orientation) return;

      if (!glyphs.length || glyphs[0].parentNode !== textElement) {
        glyphs = Array.from(textElement.childNodes)
          .filter(node => node.nodeType === Node.TEXT_NODE && node.data.trim())
          .map(node => {
            const glyph = document.createElement("span");
            glyph.style.display = "inline-block";
            node.before(glyph);
            glyph.append(node);
            return glyph;
          });
      }
      if (!glyphs.length) return;

      // Conjugate(calibration) × orientation expresses the pose in the initial device frame.
      const [a, b, c, d] = calibration;
      const [w, x, y, z] = orientation;
      const scalar = a * w + b * x + c * y + d * z;
      const front = a * x - b * w - c * z + d * y;
      const lateral = a * y + b * z - c * w - d * x;
      const axial = a * z - b * y + c * x - d * w;
      // Sign-invariant magnitudes stay continuous across half and full turns.
      const response = component => {
        const magnitude = Math.hypot(2 * scalar * component, 2 * component * component);
        return 1 - Math.exp(-Math.pow(Math.max(0, magnitude - lens.deadZone) / lens.sensitivity, 1.15));
      };
      const side = 2 * scalar * lateral;
      const center = 0.5 + lens.travel * Math.tanh(side / (lens.sensitivity + 0.8 * (1 - scalar * scalar)));
      const twist = response(axial);
      const spread = lens.minSpread + twist * (lens.maxSpread - lens.minSpread);
      const depth = lens.maxCompression * Math.max(response(front), 0.8 * response(lateral), 0.65 * twist);
      const weights = glyphs.map((_, index) => {
        const distance = (index / Math.max(1, glyphs.length - 1) - center) / spread;
        return Math.exp(-0.5 * distance * distance);
      });
      // Keep one line at its original width and squeeze the others around their center.
      const edge = Math.min(...weights);
      glyphs.forEach((glyph, index) => {
        glyph.style.transform = `scaleX(${(1 - depth * (weights[index] - edge)).toFixed(4)})`;
      });
    }

    function canUseOrientation() {
      return window.isSecureContext && mobileViewport.matches && !reducedMotion.matches;
    }

    function syncOrientation() {
      const shouldListen = canUseOrientation() && (permission === "automatic" || permission === "granted");
      if (shouldListen !== listening) {
        listening = shouldListen;
        if (listening) {
          window.addEventListener("deviceorientation", sampleOrientation);
        } else {
          window.removeEventListener("deviceorientation", sampleOrientation);
          cancelAnimationFrame(lensFrame);
          lensFrame = 0;
          calibration = null;
          orientation = null;
          heading = 0;
          headingOffset = 0;
          hasHeading = false;
          glyphs.forEach(glyph => glyph.replaceWith(...glyph.childNodes));
          glyphs = [];
          applyScrollScale();
        }
      }
      updateDebug();
    }

    stage.addEventListener("click", async () => {
      if (!canUseOrientation() || (permission !== "prompt" && permission !== "error")) return;
      permission = "requesting";
      try {
        // Safari requires the call to start within the trusted tap, before any await.
        const request = orientationEvent.requestPermission();
        updateDebug();
        const result = await request;
        permission = result === "granted" ? "granted" : "denied";
      } catch {
        permission = "error";
      }
      syncOrientation();
    });

    mobileViewport.addEventListener("change", syncOrientation);
    reducedMotion.addEventListener("change", syncOrientation);
    syncOrientation();

    function fitWordmark() {
      const availableHeight = stage.clientHeight - 6;
      const availableWidth = stage.clientWidth - 12;
      let low = 12;
      let high = 200;
      for (let i = 0; i < 12; i += 1) {
        const middle = (low + high) / 2;
        textElement.style.fontSize = `${middle}px`;
        if (textElement.scrollHeight <= availableHeight && textElement.offsetWidth <= availableWidth) low = middle;
        else high = middle;
      }
      textElement.style.fontSize = `${low}px`;
      naturalWidth = textElement.offsetWidth;
      touchMaxScale = Math.max(1, availableWidth / naturalWidth);
      if (touchViewport.matches) setScale(Math.min(currentScale, touchMaxScale));
      if (orientation && !lensFrame) lensFrame = requestAnimationFrame(renderLens);
    }

    function applyScale(clientX) {
      const centerX = window.innerWidth / 2;
      const distanceFromCenter = Math.abs(clientX - centerX);
      const factor = centerX === 0 ? 0 : distanceFromCenter / centerX;
      const currentScale = minScale + factor * (maxScale - minScale);

      setScale(currentScale);
    }

    window.addEventListener("pointermove", event => {
      if (touchViewport.matches) return;
      lastPointerX = event.clientX;
      applyScale(event.clientX);
    });

    function applyScrollScale() {
      scaleFrame = 0;
      if (!touchViewport.matches || orientation) return;
      const distance = Math.max(1, stage.clientHeight * 1.5);
      const progress = Math.min(1, Math.max(0, window.scrollY * (tabletViewport.matches ? 1 : 2) / distance));
      setScale(1 + progress * (touchMaxScale - 1));
    }

    window.addEventListener("scroll", () => {
      if (!touchViewport.matches || orientation || scaleFrame) return;
      scaleFrame = requestAnimationFrame(applyScrollScale);
    }, { passive: true });

    touchViewport.addEventListener("change", () => {
      fitWordmark();
      if (touchViewport.matches) applyScrollScale();
      else if (lastPointerX !== null) applyScale(Math.min(Math.max(lastPointerX, 0), window.innerWidth));
      else setScale(1);
    });

    window.addEventListener("resize", () => {
      fitWordmark();
      updateDebug();
      if (touchViewport.matches) { applyScrollScale(); return; }
      if (lastPointerX === null) return;
      applyScale(Math.min(Math.max(lastPointerX, 0), window.innerWidth));
    });
    new ResizeObserver(fitWordmark).observe(stage);
    document.fonts.ready.then(fitWordmark);
    fitWordmark();
    applyScrollScale();
  }

})();
