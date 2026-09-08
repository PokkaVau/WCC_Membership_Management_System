/**
 * WCC Membership Management System - Official A4 PDF Generator
 * Generates an official, beautifully formatted organizational document for a single member.
 * File naming convention: WCC-Member-{memberId}.pdf
 */

const PDF_GENERATOR = {
  /**
   * Helper to load an image URL into a base64 DataURL or return fallback
   */
  loadImageAsBase64(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 120;
          canvas.height = img.naturalHeight || 120;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  },

  /**
   * Generate official A4 PDF for the given member object
   */
  async generateMemberPDF(member) {
    if (!member) throw new Error('No member provided for PDF generation');
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('jsPDF library not loaded');
    }

    const { jsPDF } = window.jspdf;
    // Standard A4 portrait: 210mm x 297mm
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);

    // Color Palette in RGB
    const gold = [241, 173, 26];
    const crimson = [182, 42, 53];
    const navy = [29, 53, 87];
    const charcoal = [25, 29, 36];
    const grayText = [100, 110, 120];
    const darkText = [30, 35, 45];
    const lightBg = [248, 249, 251];

    // 1. Top Decorative Ribbon
    doc.setFillColor(...crimson);
    doc.rect(0, 0, pageWidth, 8, 'F');
    doc.setFillColor(...gold);
    doc.rect(0, 8, pageWidth, 2.5, 'F');

    // 2. Header Area
    let currentY = 22;

    // Header Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...navy);
    doc.text('WE CAN CHANGE (WCC)', margin, currentY);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...grayText);
    doc.text('Empowering People, Changing Society | Reg. Non-Profit Organization', margin, currentY + 5);

    // Document Meta (Right aligned)
    doc.setFontSize(8);
    doc.setTextColor(...navy);
    doc.text('OFFICIAL MEMBERSHIP RECORD', pageWidth - margin, currentY - 2, { align: 'right' });
    doc.setTextColor(...grayText);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, pageWidth - margin, currentY + 3, { align: 'right' });
    doc.text(`ID: ${member.memberId}`, pageWidth - margin, currentY + 8, { align: 'right' });

    // Decorative line
    currentY += 14;
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.75);
    doc.line(margin, currentY, pageWidth - margin, currentY);

    // 3. Member Banner Card
    currentY += 6;
    const bannerHeight = 36;
    doc.setFillColor(...lightBg);
    doc.roundedRect(margin, currentY, contentWidth, bannerHeight, 3, 3, 'F');
    doc.setDrawColor(220, 225, 230);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, currentY, contentWidth, bannerHeight, 3, 3, 'S');

    // Try embedding photo
    const photoBase64 = await this.loadImageAsBase64(member.photoUrl);
    const photoSize = 28;
    const photoX = margin + 4;
    const photoY = currentY + 4;

    if (photoBase64) {
      try {
        doc.addImage(photoBase64, 'JPEG', photoX, photoY, photoSize, photoSize);
        doc.setDrawColor(...gold);
        doc.setLineWidth(0.5);
        doc.rect(photoX, photoY, photoSize, photoSize, 'S');
      } catch (e) {
        // Fallback placeholder
        doc.setFillColor(...charcoal);
        doc.rect(photoX, photoY, photoSize, photoSize, 'F');
      }
    } else {
      doc.setFillColor(...charcoal);
      doc.rect(photoX, photoY, photoSize, photoSize, 'F');
      doc.setTextColor(...gold);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('WCC', photoX + 7, photoY + 16);
    }

    // Member Banner Details
    const textStartX = photoX + photoSize + 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...charcoal);
    doc.text(member.name || 'Unnamed Member', textStartX, currentY + 11);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...crimson);
    doc.text(`Member ID: ${member.memberId}`, textStartX, currentY + 18);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...navy);
    doc.text(`Status: ${(member.status || 'Pending').toUpperCase()}   |   Blood Group: ${member.bloodGroup || 'N/A'}   |   Type: ${member.membershipType || 'General Member'}`, textStartX, currentY + 26);

    currentY += bannerHeight + 8;

    // Helper to draw section header
    const drawSectionHeader = (title) => {
      doc.setFillColor(...navy);
      doc.rect(margin, currentY, 3, 6, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...navy);
      doc.text(title.toUpperCase(), margin + 6, currentY + 4.8);
      currentY += 8;

      doc.setDrawColor(225, 230, 235);
      doc.setLineWidth(0.2);
      doc.line(margin, currentY, pageWidth - margin, currentY);
      currentY += 3;
    };

    // Helper to render 2-column or 3-column key-value rows
    const renderRow2Col = (label1, val1, label2, val2) => {
      const col1X = margin;
      const col1ValX = margin + 35;
      const col2X = margin + 95;
      const col2ValX = margin + 130;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...grayText);
      doc.text(label1, col1X, currentY);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...darkText);
      doc.text(String(val1 || 'Not provided'), col1ValX, currentY);

      if (label2) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...grayText);
        doc.text(label2, col2X, currentY);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...darkText);
        doc.text(String(val2 || 'Not provided'), col2ValX, currentY);
      }

      currentY += 6;
    };

    // 4. Section: Personal Information
    drawSectionHeader('1. Personal Information');
    const ageStr = member.age !== null ? `${member.age} years` : 'Not provided';
    renderRow2Col('Full Name:', member.name, 'Date of Birth:', `${member.formattedDob} (Age: ${ageStr})`);
    renderRow2Col('Gender:', member.gender, 'Blood Group:', member.bloodGroup);
    renderRow2Col('Phone:', member.phone, 'Email Address:', member.email);
    currentY += 4;

    // 5. Section: Address Details
    drawSectionHeader('2. Address Details');
    renderRow2Col('Division:', member.division, 'District:', member.district);
    renderRow2Col('Upazila:', member.upazila, 'Union:', member.union);
    renderRow2Col('Present Address:', member.presentAddress, 'Permanent Address:', member.permanentAddress);
    currentY += 4;

    // 6. Section: Educational Information
    drawSectionHeader('3. Educational Background');
    const isStudying = (member.currentlyStudying === 'হ্যাঁ' || (member.currentlyStudying && String(member.currentlyStudying).toLowerCase().includes('yes')));
    if (isStudying) {
      renderRow2Col('Currently Studying:', 'Yes / হ্যাঁ (Studying)', 'Class / Year:', member.classYear || '-');
      renderRow2Col('Current Institution:', member.currentInstitution || member.institution || '-', 'Last Public Exam:', member.lastPublicExam || '-');
      renderRow2Col('Exam Result:', member.publicExamResult || '-', '', '');
    } else {
      renderRow2Col('Currently Studying:', 'No / না (Graduated)', 'Last Qualification:', member.lastQualification || member.degree || '-');
      renderRow2Col('Academic Result:', member.lastResult || '-', 'Last Institution:', member.lastInstitution || '-');
      if (member.lastPublicExam) {
        renderRow2Col('Previous Public Exam:', member.lastPublicExam, 'Result:', member.publicExamResult || '-');
      }
    }
    currentY += 4;

    // 7. Section: Professional Information
    drawSectionHeader('4. Professional Information');
    renderRow2Col('Profession:', member.profession, 'Organization:', member.organization);
    renderRow2Col('Designation:', member.designation, '', '');
    currentY += 4;

    // 8. Section: WCC Membership Information
    drawSectionHeader('5. Official WCC Membership Details');
    renderRow2Col('Member ID:', member.memberId, 'Membership Type:', member.membershipType || 'General Member');
    renderRow2Col('Registration Date:', member.formattedRegDate, 'Joining Date:', member.formattedJoiningDate);
    renderRow2Col('Membership Status:', member.status || 'Pending', '', '');

    // 9. Signatures Area
    currentY = Math.max(currentY + 12, pageHeight - 48);
    const sigLineY = currentY + 16;
    
    // Member Signature line
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.4);
    doc.line(margin + 10, sigLineY, margin + 65, sigLineY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...grayText);
    doc.text("Member's Signature", margin + 22, sigLineY + 5);

    // Authorized Secretary line
    doc.line(pageWidth - margin - 65, sigLineY, pageWidth - margin - 10, sigLineY);
    doc.text('Authorized Signature (WCC)', pageWidth - margin - 58, sigLineY + 5);

    // 10. Official Footer
    doc.setFillColor(...charcoal);
    doc.rect(0, pageHeight - 14, pageWidth, 14, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(230, 230, 230);
    doc.text('We Can Change – WCC  |  Empowering People, Changing Society  |  www.wecanchange.org', pageWidth / 2, pageHeight - 6, { align: 'center' });

    // Save PDF
    const filename = `WCC-Member-${member.memberId}.pdf`;
    doc.save(filename);
    return true;
  }
};
