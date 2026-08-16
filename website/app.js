document.addEventListener('DOMContentLoaded', () => {
  const SUPPORT_EMAIL = 'support@jeddah.dev';
  const PRODUCT_NAME = 'HotSwap for Claude (v1.0.0)';
  const EXTENSION_ID = 'nnpnmjhealgmnbinplmccegkecabcpdk';
  const SITE_URL = 'https://hotswap.jeddah.dev';

  // 1. Interactive Showcase Tab Switching
  const tabButtons = document.querySelectorAll('.showcase-tabs-nav .tab-btn');
  const showcasePanes = document.querySelectorAll('.showcase-pane');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');

      // Update button states
      tabButtons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      // Update pane states
      showcasePanes.forEach(pane => {
        pane.classList.remove('active');
      });
      const activePane = document.getElementById(`pane-${targetTab}`);
      if (activePane) {
        activePane.classList.add('active');
      }
    });
  });

  // 2. Smooth FAQ Accordion (Zero Page Jump / Scroll Shifting)
  const faqCards = document.querySelectorAll('.faq-card');

  faqCards.forEach(card => {
    const trigger = card.querySelector('.faq-trigger');
    if (!trigger) return;

    trigger.addEventListener('click', (e) => {
      e.preventDefault(); // Prevents jump
      const isOpen = card.classList.contains('open');

      // Close other open cards for clean single-accordion feel
      faqCards.forEach(c => {
        if (c !== card) {
          c.classList.remove('open');
          const t = c.querySelector('.faq-trigger');
          if (t) t.setAttribute('aria-expanded', 'false');
        }
      });

      // Toggle current card
      if (isOpen) {
        card.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      } else {
        card.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // 3. Client Environment Auto-Detection (High Precision)
  const envInput = document.getElementById('contact-env');
  let detectedClientEnv = 'Chrome on Windows';

  async function detectPreciseEnvironment() {
    const lang = navigator.language || 'en-US';
    let browserName = 'Browser';
    let browserVersion = '';
    let osName = 'Unknown OS';
    let arch = '';

    // A. Use modern User-Agent Client Hints API (Chromium / Edge / Brave / Chrome)
    if (navigator.userAgentData) {
      try {
        const highEntropy = await navigator.userAgentData.getHighEntropyValues([
          'platform',
          'platformVersion',
          'architecture',
          'bitness',
          'uaFullVersion',
          'fullVersionList'
        ]);

        const platform = highEntropy.platform || navigator.userAgentData.platform;
        const pVersion = highEntropy.platformVersion || '';

        if (platform === 'Windows') {
          const major = parseInt((pVersion.split('.')[0] || '0'), 10);
          if (major >= 13) {
            osName = 'Windows 11';
          } else if (major >= 1) {
            osName = 'Windows 10';
          } else {
            osName = 'Windows';
          }
        } else if (platform === 'macOS') {
          const major = pVersion.split('.')[0];
          osName = major ? `macOS ${major}` : 'macOS';
        } else if (platform === 'Android') {
          osName = pVersion ? `Android ${pVersion}` : 'Android';
        } else if (platform === 'Linux') {
          osName = 'Linux';
        } else if (platform === 'Chrome OS') {
          osName = 'ChromeOS';
        } else {
          osName = platform || 'Desktop';
        }

        if (highEntropy.architecture) {
          arch = (highEntropy.architecture === 'x86' && highEntropy.bitness === '64') ? 'x64' : highEntropy.architecture;
        }

        if (navigator.brave && typeof navigator.brave.isBrave === 'function' && await navigator.brave.isBrave()) {
          browserName = 'Brave';
        }

        const brands = highEntropy.fullVersionList || navigator.userAgentData.brands || [];
        const edgeBrand = brands.find(b => b.brand.includes('Microsoft Edge') || b.brand.includes('Edge'));
        const chromeBrand = brands.find(b => b.brand === 'Google Chrome' || b.brand === 'Chrome');
        const vivaldiBrand = brands.find(b => b.brand.includes('Vivaldi'));
        const operaBrand = brands.find(b => b.brand.includes('Opera'));

        if (edgeBrand) {
          browserName = 'Microsoft Edge';
          browserVersion = edgeBrand.version;
        } else if (vivaldiBrand) {
          browserName = 'Vivaldi';
          browserVersion = vivaldiBrand.version;
        } else if (operaBrand) {
          browserName = 'Opera';
          browserVersion = operaBrand.version;
        } else if (browserName === 'Brave') {
          browserVersion = highEntropy.uaFullVersion || (chromeBrand ? chromeBrand.version : '');
        } else if (chromeBrand) {
          browserName = 'Chrome';
          browserVersion = chromeBrand.version || highEntropy.uaFullVersion || '';
        } else if (brands.length > 0) {
          const significant = brands.find(b => !b.brand.includes('Not') && !b.brand.includes('Chromium'));
          if (significant) {
            browserName = significant.brand;
            browserVersion = significant.version;
          }
        }
      } catch (e) {
        // Fall through to User-Agent parser
      }
    }

    // B. Fallback parser if User-Agent Client Hints did not populate everything
    if (!browserVersion || osName === 'Unknown OS') {
      const ua = navigator.userAgent;

      if (ua.includes('Firefox/')) {
        browserName = 'Firefox';
        browserVersion = ua.match(/Firefox\/([\d.]+)/)?.[1] || '';
      } else if (ua.includes('Edg/')) {
        browserName = 'Microsoft Edge';
        browserVersion = ua.match(/Edg\/([\d.]+)/)?.[1] || '';
      } else if (ua.includes('OPR/') || ua.includes('Opera/')) {
        browserName = 'Opera';
        browserVersion = ua.match(/(?:OPR|Opera)\/([\d.]+)/)?.[1] || '';
      } else if (ua.includes('Chrome/')) {
        if (!browserName || browserName === 'Browser') browserName = 'Chrome';
        if (!browserVersion) browserVersion = ua.match(/Chrome\/([\d.]+)/)?.[1] || '';
      } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
        browserName = 'Safari';
        browserVersion = ua.match(/Version\/([\d.]+)/)?.[1] || '';
      }

      if (osName === 'Unknown OS') {
        if (ua.includes('Windows NT 10.0')) osName = 'Windows 10 / 11';
        else if (ua.includes('Windows NT 6.3')) osName = 'Windows 8.1';
        else if (ua.includes('Windows NT 6.2')) osName = 'Windows 8';
        else if (ua.includes('Windows NT 6.1')) osName = 'Windows 7';
        else if (ua.includes('Mac OS X')) {
          const v = ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') || '';
          osName = v ? `macOS ${v}` : 'macOS';
        } else if (ua.includes('Linux')) osName = 'Linux';
        else if (ua.includes('Android')) {
          const v = ua.match(/Android ([\d.]+)/)?.[1] || '';
          osName = v ? `Android ${v}` : 'Android';
        } else if (ua.includes('iPhone') || ua.includes('iPad')) {
          osName = 'iOS';
        }
      }
    }

    const browserPart = browserVersion ? `${browserName} ${browserVersion}` : browserName;
    const archPart = arch ? `, ${arch}` : '';
    detectedClientEnv = `${browserPart} on ${osName} (${lang}${archPart})`;

    if (envInput) {
      envInput.value = detectedClientEnv;
    }
  }

  detectPreciseEnvironment();

  // 4. Custom Styled Category Dropdown
  const customSelect = document.getElementById('custom-category-select');
  const triggerBtn = document.getElementById('category-trigger');
  const categoryValueSpan = triggerBtn ? triggerBtn.querySelector('.custom-select-value') : null;
  const categoryHiddenInput = document.getElementById('contact-category');
  const customOptions = document.querySelectorAll('.custom-option');

  if (customSelect && triggerBtn) {
    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = customSelect.classList.contains('open');
      customSelect.classList.toggle('open', !isOpen);
      triggerBtn.setAttribute('aria-expanded', String(!isOpen));
    });

    customOptions.forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = opt.getAttribute('data-value');
        const display = opt.getAttribute('data-display') || opt.textContent.trim();

        // Update hidden input
        if (categoryHiddenInput) categoryHiddenInput.value = val;

        // Update display text/icon
        if (categoryValueSpan) categoryValueSpan.textContent = display;

        // Update active class
        customOptions.forEach(o => {
          o.classList.remove('selected');
          o.setAttribute('aria-selected', 'false');
        });
        opt.classList.add('selected');
        opt.setAttribute('aria-selected', 'true');

        // Close dropdown
        customSelect.classList.remove('open');
        triggerBtn.setAttribute('aria-expanded', 'false');
      });
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!customSelect.contains(e.target)) {
        customSelect.classList.remove('open');
        triggerBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Keyboard navigation
    customSelect.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        customSelect.classList.remove('open');
        triggerBtn.setAttribute('aria-expanded', 'false');
        triggerBtn.focus();
      }
    });
  }

  // 5. Support Form Submission
  const form = document.getElementById('support-form');
  const nameInput = document.getElementById('contact-name');
  const emailInput = document.getElementById('contact-email');
  const categorySelect = document.getElementById('contact-category');
  const subjectInput = document.getElementById('contact-subject');
  const messageInput = document.getElementById('contact-message');
  const toast = document.getElementById('form-toast');

  function showToast(message, isSuccess = true) {
    if (!toast) return;
    toast.textContent = message;
    toast.className = `form-toast ${isSuccess ? 'success' : 'error'}`;
    toast.style.display = 'block';

    setTimeout(() => {
      toast.style.display = 'none';
    }, 6000);
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const name = (nameInput.value || '').trim();
      const email = (emailInput.value || '').trim();
      const category = categorySelect.value || 'General Inquiry';
      const rawSubject = (subjectInput.value || '').trim();
      const message = (messageInput.value || '').trim();

      if (!name || !email || !message) {
        showToast('Please fill in your name, email, and message before sending.', false);
        return;
      }

      const sourceUrl = window.location.href || SITE_URL;
      const now = new Date();
      const timestampStr = `${now.toISOString()} (${now.toLocaleString()})`;

      const emailSubject = `[HotSwap for Claude] [${category}] ${rawSubject || 'Support Ticket'}`;

      const emailBody = 
`=====================================================
HOTSWAP FOR CLAUDE — SUPPORT REQUEST
=====================================================
• Product: ${PRODUCT_NAME}
• Extension ID: ${EXTENSION_ID}
• Submitted From: ${sourceUrl}
• Inquiry Category: ${category}
• Sender Name: ${name}
• Sender Email: ${email}
• Client Environment: ${detectedClientEnv}
• Timestamp: ${timestampStr}
=====================================================

USER MESSAGE:
-----------------------------------------------------
${message}
-----------------------------------------------------

(Automated ticket submitted via https://hotswap.jeddah.dev)`;

      const mailtoUrl = `mailto:${encodeURIComponent(SUPPORT_EMAIL)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

      showToast(`Launching email client for ${SUPPORT_EMAIL}...`, true);

      // Trigger mailto link
      const a = document.createElement('a');
      a.href = mailtoUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }
});
