/**
 * WCC Membership Management System - QR Code Generator Module
 * Encodes safe verification URL into high-resolution QR codes.
 */

const QR_SYSTEM = {
  /**
   * Render QR Code inside a specified container element
   */
  renderQRCode(container, text, size = 180) {
    if (!container) return;
    container.innerHTML = '';

    if (typeof QRCode !== 'undefined') {
      new QRCode(container, {
        text: text,
        width: size,
        height: size,
        colorDark: "#191D24",
        colorLight: "#FFFFFF",
        correctLevel: QRCode.CorrectLevel.H
      });
    } else {
      // Fallback if QRCode library not yet loaded: use Google Chart QR API or SVG placeholder
      const img = document.createElement('img');
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
      img.alt = 'Verification QR Code';
      img.style.width = `${size}px`;
      img.style.height = `${size}px`;
      container.appendChild(img);
    }
  },

  /**
   * Generate QR Code as a DataURL
   */
  async getQRCodeDataURL(text, size = 200) {
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    document.body.appendChild(tempDiv);

    this.renderQRCode(tempDiv, text, size);

    // Allow canvas to render
    await new Promise(r => setTimeout(r, 100));

    let dataUrl = null;
    const canvas = tempDiv.querySelector('canvas');
    if (canvas) {
      dataUrl = canvas.toDataURL('image/png');
    } else {
      const img = tempDiv.querySelector('img');
      if (img) dataUrl = img.src;
    }

    document.body.removeChild(tempDiv);
    return dataUrl;
  }
};
