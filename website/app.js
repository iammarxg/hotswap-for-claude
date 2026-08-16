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

  // 3. Client Environment Auto-Detection
  const envInput = document.getElementById('contact-env');

  function detectEnvironment() {
    const ua = navigator.userAgent;
    let browser = 'Chrome';
    let os = 'Windows';

    if (ua.includes('Firefox/')) {
      const v = ua.split('Firefox/')[1]?.split(' ')[0] || '';
      browser = `Firefox ${v}`;
    } else if (ua.includes('Edg/')) {
      const v = ua.split('Edg/')[1]?.split(' ')[0] || '';
      browser = `Edge ${v}`;
    } else if (ua.includes('Chrome/')) {
      const v = ua.split('Chrome/')[1]?.split(' ')[0] || '';
      browser = `Chrome ${v}`;
    } else if (ua.includes('Safari/') && !ua.includes('Chrome/')) {
      browser = 'Safari';
    }

    if (ua.includes('Win')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    const lang = navigator.language || 'en-US';
    return `${browser} on ${os} (${lang})`;
  }

  const clientEnv = detectEnvironment();
  if (envInput) {
    envInput.value = clientEnv;
  }

  // 4. Support Form Submission
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
• Client Environment: ${clientEnv}
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
