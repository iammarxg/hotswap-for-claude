document.addEventListener('DOMContentLoaded', () => {
  const SUPPORT_EMAIL = 'support@jeddah.dev';
  const PRODUCT_NAME = 'HotSwap for Claude (v1.0.0)';

  // Form Elements
  const form = document.getElementById('support-form');
  const nameInput = document.getElementById('contact-name');
  const emailInput = document.getElementById('contact-email');
  const categorySelect = document.getElementById('contact-category');
  const subjectInput = document.getElementById('contact-subject');
  const messageInput = document.getElementById('contact-message');
  const envInput = document.getElementById('contact-env');
  const previewBox = document.getElementById('email-preview-box');
  const copyBtn = document.getElementById('btn-copy-format');
  const toast = document.getElementById('form-toast');

  // Detect Client Environment
  function detectEnvironment() {
    const ua = navigator.userAgent;
    let browser = 'Unknown Browser';
    let os = 'Unknown OS';

    // Browser detection
    if (ua.includes('Firefox/')) {
      const v = ua.split('Firefox/')[1]?.split(' ')[0] || '';
      browser = `Firefox ${v}`;
    } else if (ua.includes('Edg/')) {
      const v = ua.split('Edg/')[1]?.split(' ')[0] || '';
      browser = `Microsoft Edge ${v}`;
    } else if (ua.includes('Chrome/')) {
      const v = ua.split('Chrome/')[1]?.split(' ')[0] || '';
      browser = `Chrome ${v}`;
    } else if (ua.includes('Safari/') && !ua.includes('Chrome/')) {
      browser = 'Safari';
    }

    // OS detection
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

  // Generate Email Subject & Body
  function getFormattedEmailData() {
    const name = (nameInput.value || '').trim() || '[Sender Name]';
    const email = (emailInput.value || '').trim() || '[Sender Email]';
    const category = categorySelect.value || 'General Inquiry';
    const rawSubject = (subjectInput.value || '').trim() || 'General Inquiry';
    const message = (messageInput.value || '').trim() || '[No message provided]';
    const sourceUrl = window.location.href || 'https://hotswap-claude.pages.dev';
    const now = new Date();
    const timestampStr = `${now.toISOString()} (${now.toLocaleString()})`;

    const emailSubject = `[HotSwap for Claude] [${category}] ${rawSubject}`;

    const emailBody = 
`=====================================================
HOTSWAP FOR CLAUDE — SUPPORT REQUEST
=====================================================
• Product: ${PRODUCT_NAME}
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

(Automated support ticket generated via HotSwap web portal)`;

    return {
      to: SUPPORT_EMAIL,
      subject: emailSubject,
      body: emailBody,
      name,
      email,
      category,
      rawSubject,
      message
    };
  }

  // Update Live Preview Box
  function updateLivePreview() {
    if (!previewBox) return;
    const data = getFormattedEmailData();
    previewBox.textContent = `To: ${data.to}\nSubject: ${data.subject}\n\n${data.body}`;
  }

  // Attach input listeners for live preview
  [nameInput, emailInput, categorySelect, subjectInput, messageInput].forEach(el => {
    if (el) {
      el.addEventListener('input', updateLivePreview);
      el.addEventListener('change', updateLivePreview);
    }
  });

  updateLivePreview();

  // Show status toast
  function showToast(message, isSuccess = true) {
    if (!toast) return;
    toast.textContent = message;
    toast.className = `form-toast ${isSuccess ? 'success' : 'error'}`;
    toast.style.display = 'block';

    setTimeout(() => {
      toast.style.display = 'none';
    }, 6000);
  }

  // Form Submission -> mailto:
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      if (!nameInput.value.trim() || !emailInput.value.trim() || !messageInput.value.trim()) {
        showToast('Please fill in your name, email, and message before sending.', false);
        return;
      }

      const data = getFormattedEmailData();
      const mailtoUrl = `mailto:${encodeURIComponent(data.to)}?subject=${encodeURIComponent(data.subject)}&body=${encodeURIComponent(data.body)}`;

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

  // Copy to Clipboard Fallback
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const data = getFormattedEmailData();
      const clipboardText = `To: ${data.to}\nSubject: ${data.subject}\n\n${data.body}`;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(clipboardText).then(() => {
          showToast(`✓ Formatted request copied! Send to ${SUPPORT_EMAIL}`, true);
        }).catch(() => {
          fallbackCopy(clipboardText);
        });
      } else {
        fallbackCopy(clipboardText);
      }
    });
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast(`✓ Formatted request copied! Send to ${SUPPORT_EMAIL}`, true);
    } catch (err) {
      showToast('Could not copy automatically. Please select text from the preview box.', false);
    }
    document.body.removeChild(ta);
  }
});
