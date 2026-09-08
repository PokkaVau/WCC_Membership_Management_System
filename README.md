# We Can Change (WCC) – Membership Management & Member Directory Dashboard

An enterprise-grade, responsive, modern, secure Membership Management and Member Directory web application designed specifically for **We Can Change (WCC)**.

---

## 📋 Table of Contents
1. [Overview & Features](#overview--features)
2. [Application Directory Structure](#application-directory-structure)
3. [Technology Stack](#technology-stack)
4. [Color Palette & Design System](#color-palette--design-system)
5. [Quick Start & Local Running](#quick-start--local-running)
6. [Google Sheet & Google Apps Script Setup](#google-sheet--google-apps-script-setup)
7. [Central Field Mapping Configuration](#central-field-mapping-configuration)
8. [Individual A4 PDF Generation](#individual-a4-pdf-generation)
9. [Digital Membership Cards & QR Verification](#digital-membership-cards--qr-verification)
10. [Security & Privacy Architecture](#security--privacy-architecture)
11. [Deployment Guide](#deployment-guide)
12. [Future Upgrade Recommendations](#future-upgrade-recommendations)

---

## 1. Overview & Features

- **Executive Dashboard**: Dynamic calculation of Total, Active, Pending, Inactive, Male, Female, Student, and Professional members.
- **Member Directory**:
  - Global instant multi-field search (Name, ID, Phone, Email, Blood group, District, Upazila, Institution, Profession).
  - Multi-filter engine (Status, Gender, Blood Group, District, Upazila, Category, Profession).
  - Multi-parameter sorting and configurable pagination (10, 25, 50, 100).
  - Responsive table on desktop/tablet; converts automatically to touch cards on mobile screens (`<768px`).
- **Individual Member Profile**:
  - Hero profile card with photo, ID, and status badge.
  - Grouped sections: Personal, Address, Education, Professional, and WCC details.
  - Interactive status update modal with local cache persistence.
  - One-click official A4 PDF report generation.
- **Official A4 PDF Generator**:
  - Automatically produces an official document for the selected member (`WCC-Member-{MemberID}.pdf`).
  - Vector headers, official logo, photo, structured 2-column tables, signature blocks, and official footer.
- **QR Code & Public Verification**:
  - Dynamic QR code generation encoding a safe public link (`verify.html?id={memberId}`).
  - Verification endpoint protects sensitive PII: displays only photo, name, ID, status, and joining date.
- **6 Interactive Analytics Charts** powered by Chart.js (Blood Group, Gender, District, Upazila, Age, and Registration Trend).
- **Dark/Light Mode**: User preference stored in `localStorage` and synchronized across tabs.
- **CSV Data Exporter**: Export all or filtered members with UTF-8 BOM encoding for Excel compatibility.

---

## 2. Application Directory Structure

```
WCC_Membership_Management_System/
│
├── index.html                   # Admin authentication portal
├── dashboard.html               # Main executive KPI dashboard
├── members.html                 # Members directory (table, mobile cards, search, filters)
├── member.html                  # Single member profile with PDF/Card/QR actions
├── analytics.html               # Comprehensive analytics (6 Chart.js graphs)
├── verify.html                  # Public QR verification landing page
├── settings.html                # Organization settings, API toggles, cache controls
│
├── css/
│   ├── style.css                # Core design system, themes, typography, buttons, modals
│   ├── dashboard.css            # Metric cards, KPI grids, demographic strip
│   ├── members.css              # Data table, filter panel, mobile cards, ID card styles
│   └── responsive.css           # Breakpoints (320px–1440px+) and @media print rules
│
├── js/
│   ├── config.js                # Central API URL, MEMBER_FIELDS mapping, org info
│   ├── mockData.js              # 20+ realistic member records for development/demo
│   ├── utils.js                 # XSS prevention, age calculation, date formatting, CSV export
│   ├── api.js                   # Unified API client, caching, search, status updater
│   ├── auth.js                  # Route guard, demo session management, theme toggle
│   ├── dashboard.js             # KPI statistics calculator, recent registrations feed
│   ├── members.js               # Filter engine, instant debounced search, pagination
│   ├── member.js                # Profile renderer, dynamic sections, status edit modal
│   ├── analytics.js             # 6 Chart.js interactive charts
│   ├── pdf.js                   # High-res A4 PDF generator using jsPDF
│   └── qr.js                    # QRCode generator module
│
├── assets/
│   ├── logo/
│   │   └── WCC_logo.png         # Official WCC emblem
│   └── images/
│       ├── default-avatar.svg   # Fallback SVG avatar for members without photos
│       └── badge-verified.svg   # Green verified checkmark emblem
│
├── backend/
│   └── GoogleAppsScript.gs      # Production-ready Google Sheet Web App script (doGet/doPost)
│
└── README.md                    # System documentation and deployment guide
```

---

## 3. Technology Stack

- **Frontend**: HTML5, Modern CSS3 (CSS Variables, Flexbox, CSS Grid), Vanilla JavaScript (ES6+).
- **Libraries (CDN-based, lightweight)**:
  - [Chart.js 4.4](https://cdn.jsdelivr.net/npm/chart.js): High-performance canvas charts.
  - [jsPDF 2.5](https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js): Official vector A4 PDF generation.
  - [html2canvas 1.4](https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js): High-resolution DOM to image converter.
  - [QRCode.js 1.0](https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js): Client-side QR generation.
- **Typography**: Google Fonts ([Poppins](https://fonts.google.com/specimen/Poppins) & [Hind Siliguri](https://fonts.google.com/specimen/Hind+Siliguri)).

---

## 4. Color Palette & Design System

| Color Name | HEX | Usage |
|---|---|---|
| 🟡 **Golden Yellow** | `#F1AD1A` | Borders, accents, brand lettering, stars |
| 🔴 **Deep Crimson Red** | `#B62A35` | Primary brand buttons, inner emblem, badges |
| 🟥 **Light Crimson** | `#BE464F` | Gradients, button hovers, badge accents |
| ⚫ **Black** | `#000000` | Contrast backgrounds, text on gold |
| ⚪ **White** | `#FFFFFF` | Text, card backgrounds in light theme |
| 🔵 **Deep Navy Blue** | `#1D3557` | Hero banners, secondary buttons, sidebar in light mode |
| 🟢 **Green** | `#169053` | Active status badges, verified emblems |
| 🟤 **Dark Gold / Brown**| `#A6772A` | Gold borders and shading |
| 🌑 **Dark Charcoal** | `#191D24` | Dark mode surface background, ID card body |
| 🩶 **Dark Gray** | `#212121` | Subtle borders, toolbars, metadata strips |

---

## 5. Quick Start & Local Running

1. **Serve locally**:
   Because the application uses ES6 features and fetches mock/live data, run any static web server:
   ```bash
   # Using Python 3:
   python -m http.server 8000

   # Or using Node.js npx:
   npx serve .
   ```
2. **Open in browser**:
   Navigate to: `http://localhost:8000`
3. **Log in with demo credentials**:
   - **Username / Email**: `admin@wecanchange.org` (or `admin`)
   - **Password**: `wccadmin2026`

---

## 6. Google Sheet & Google Apps Script Setup

To connect your existing Google Sheet as the live database:

1. Open your Google Sheet containing the member records.
2. Ensure the first row contains your column headers.
3. Click **Extensions** > **Apps Script**.
4. Paste the entire content of [`backend/GoogleAppsScript.gs`](file:///c:/My%20Projects/WCC_Membership_Management_System/backend/GoogleAppsScript.gs).
5. Click **Deploy** > **New deployment**.
6. Select type: **Web app**.
   - **Description**: `WCC Membership API`
   - **Execute as**: `Me` (your Google Account)
   - **Who has access**: `Anyone`
7. Click **Deploy**, authorize access, and copy the provided Web App URL (e.g. `https://script.google.com/macros/s/AKfycb.../exec`).
8. Open `js/config.js` and set:
   ```javascript
   CONFIG.API_URL = "https://script.google.com/macros/s/AKfycb.../exec";
   CONFIG.USE_MOCK_DATA = false;
   ```
9. Alternatively, you can configure this directly via the UI on the **Settings** page (`settings.html`).

---

## 7. Central Field Mapping Configuration

In [`js/config.js`](file:///c:/My%20Projects/WCC_Membership_Management_System/js/config.js), verify that `CONFIG.MEMBER_FIELDS` matches your actual Google Sheet column headers:

```javascript
MEMBER_FIELDS: {
  memberId: "Member ID",
  name: "Name",
  dob: "Date of Birth",
  gender: "Gender",
  bloodGroup: "Blood Group",
  phone: "Phone",
  email: "Email",
  photo: "Photo",
  division: "Division",
  district: "District",
  upazila: "Upazila",
  union: "Union",
  village: "Village/Area",
  presentAddress: "Present Address",
  permanentAddress: "Permanent Address",
  currentlyStudying: "Currently Studying",
  institution: "Institution",
  department: "Department",
  degree: "Degree",
  lastExam: "Last Public Examination",
  passingYear: "Passing Year",
  profession: "Profession",
  organization: "Organization",
  designation: "Designation",
  status: "Status",
  membershipType: "Membership Type",
  registrationDate: "Registration Date",
  joiningDate: "Joining Date"
}
```
If your sheet does not have a particular column, leave it mapped or remove it; the application automatically hides empty fields or displays `"Not provided"` without throwing errors.

---

## 8. Individual A4 PDF Generation

- In `members.html`, click the crimson **PDF** button on any member row.
- Or on `member.html`, click **Download PDF**.
- **Result**: The system compiles only the chosen member's details into an official A4 document named `WCC-Member-{memberId}.pdf`.

---

## 9. QR Code Verification

1. On any member's profile page (`member.html`), click **Generate QR**.
2. A modal displays a high-resolution QR code encoding the safe verification URL (`verify.html?id={memberId}`).
3. **Scanning the QR Code**:
   - Directs the scanner to `verify.html?id={memberId}`.
   - Shows verified checkmark, photo, name, Member ID, status, and joining date.
   - **Strictly excludes phone, email, full address, and NID to maintain member privacy.**

---

## 10. Security & Privacy Architecture

- **No Exposed Secrets**: Frontend scripts do not embed any private API keys, client secrets, or service account credentials. Google Apps Script serves public GET requests anonymously with read access to the sheet.
- **XSS Prevention**: All user-supplied values from the Google Sheet pass through `UTILS.escapeHTML()` before DOM insertion.
- **Privacy Compliance**: Public verification QR endpoint restricts data presentation strictly to safe identity confirmation tokens.
- **Production Authentication Note**: The included login system is a front-end session gate for demonstration and local administration. For internet-facing production deployments, route traffic through a backend proxy (Node.js/Express, Python/FastAPI, or Next.js API routes) with HTTP-only session cookies or JWT verification.

---

## 11. Deployment Guide

### Option A: Static Web Hosting (GitHub Pages / Netlify / Vercel)
1. Push this repository to GitHub.
2. In GitHub, go to **Settings** > **Pages** > Select Branch `main` > Save.
3. Your dashboard will be live at `https://your-org.github.io/WCC_Membership_Management_System/`.

### Option B: Custom Apache / Nginx Web Server
1. Upload all files to `/var/www/html/wcc-dashboard/`.
2. Ensure proper MIME types for `.svg` and `.js` files.

---

## 12. Future Upgrade Recommendations

1. **Backend Authentication & Role-Based Access Control (RBAC)**: Implement JWT / OAuth2 with roles (Super Admin, District Coordinator, Data Entry Operator).
2. **Automated SMS & Email Notifications**: Hook into Google Apps Script or Twilio/SendGrid to send confirmation SMS/Email when a member is approved.
3. **Database Migration**: When membership scales past 50,000 members, migrate the Google Sheet data store to a PostgreSQL database with a RESTful API backend.
