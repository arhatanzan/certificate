# Certificate App - New Features Guide

## Feature 1: Click-to-Select Text Fields

### How to Use:
1. In the template editor, click directly on any text in the certificate preview
2. The selected field controls will update automatically
3. Alternatively, use the "Selected field" dropdown as before

### Benefits:
- Faster workflow - no need to switch between dropdown and preview
- Visual feedback - you immediately know which field is selected
- Intuitive - directly interact with the elements you want to edit

---

## Feature 2: QR Code Support

### How to Add QR Code to Certificate:

1. **Select QR Code Field:**
   - Choose "QR Code" from the "Selected field" dropdown
   - Or click where the QR code should appear

2. **Position the QR Code:**
   - Drag in the preview to move position
   - Or enter X and Y coordinates manually
   - Enter desired size (width/height in points)

3. **Configure QR Code:**
   - Show/Hide: Use the "Show/Hide" button to toggle visibility
   - Delete: Use the "Delete" button to remove from certificate
   - Color: Set the QR code color (default: black)

4. **QR Code Behavior:**
   - Automatically generates from the certificate verification URL
   - Recipients can scan to verify certificate authenticity
   - Works in PDF output

### Example Positions:
- **Top-left corner:** X: 100, Y: 550 (A4 height is 595.28)
- **Top-right corner:** X: 741, Y: 550
- **Bottom-left corner:** X: 100, Y: 50
- **Bottom-right corner:** X: 741, Y: 50

---

## Feature 3: Text Color & Formatting

### Customize Each Text Field:

#### Change Text Color:
1. Select a field (name, date, verification URL, etc.)
2. Click the color picker next to "Text color"
3. Choose your desired color
4. The preview updates immediately

#### Apply Text Formatting:
1. Select a field
2. Check "Bold text" to make text bold
3. Check "Italic text" to make text italic
4. Both can be applied together

### Color Application:
- Each field can have a different color
- Colors persist in PDF download
- Default color is dark green (#1a453b)
- Special fields like QR code can have custom colors too

### Example Use Cases:
- **Participant name:** Bold, accent color (e.g., #0066cc blue)
- **Event date:** Regular, muted color (e.g., #666666 gray)
- **Verification URL:** Smaller, light color for subtle branding
- **QR Code:** Maintains contrast for scanning

---

## Feature 4: Email Confirmation for Approvals

### Updated Approval Workflow:

#### Before (Old Flow):
1. Admin checks approval checkbox
2. Email automatically sent
3. No control over email sending

#### After (New Flow):
1. Admin checks approval checkbox
2. **Approval is saved**
3. **Confirmation dialog appears:**
   ```
   "Send certificate approval email to participant@example.com?"
   ```
4. Admin can:
   - **Click "OK"** → Email is sent to recipient
   - **Click "Cancel"** → Approval saved, but no email sent

#### Benefits:
- **Control:** Admins can approve without immediately notifying
- **Flexibility:** Send emails in batch or at specific times
- **Safety:** Prevents accidental emails
- **Audit trail:** Separate approval from notification

### Note:
- If recipient email fails, you'll see an error message
- Approval is still saved even if email fails
- Backend will retry failed emails automatically

---

## Complete Certificate Configuration Example

Here's how to set up a professional certificate:

```
Field: Participant name
├─ Position: X: 421, Y: 330
├─ Font size: 28pt
├─ Color: #0066cc (blue)
└─ Formatting: Bold

Field: Program title
├─ Position: X: 421, Y: 280
├─ Font size: 16pt
├─ Color: #666666 (gray)
└─ Formatting: Regular

Field: Event date
├─ Position: X: 421, Y: 150
├─ Font size: 11pt
├─ Color: #999999 (light gray)
└─ Formatting: Regular

Field: Verification URL
├─ Position: X: 421, Y: 80
├─ Font size: 7pt
├─ Color: #999999 (light gray)
└─ Formatting: Regular
└─ (Often hidden on printed version)

Field: QR Code
├─ Position: X: 100, Y: 150
├─ Size: 50pt
├─ Color: #000000 (black)
└─ Visibility: Visible
```

---

## Tips & Tricks

### Aligning Elements:
- Use consistent X-coordinates for vertically aligned text
- Use consistent Y-coordinates for horizontally aligned text
- Measure twice, move once using the coordinate inputs

### Color Selection:
- Use brand colors for key elements (name, title)
- Use neutral colors for supporting text (date, ID)
- Ensure good contrast for readability
- Test in PDF preview before publishing

### QR Code Best Practices:
- Place in corner or margin area
- Size: 30-50pt for good scannability
- Ensure white background space around code
- Test scanning in various lighting conditions

### Template Publishing:
- Always download preview PDF to check appearance
- Test on actual printer if physical copies needed
- Save template after making changes
- Check that colors print correctly if using color printers

---

## Troubleshooting

### QR Code Not Showing:
- Verify QR Code field is not hidden
- Check that position is within page bounds
- Ensure template is published

### Color Not Appearing in PDF:
- Verify color is selected for the field
- Try publishing template again
- Check PDF viewer supports color (not in grayscale mode)

### Email Not Sending:
- Verify recipient email address is valid
- Check network connectivity
- Review error message for specific issue
- Try again after a few minutes (retry mechanism)

### Click-to-Select Not Working:
- Click closer to the text center
- Ensure field is visible (not hidden)
- Try using dropdown instead

---

## API Integration for Backend Developers

To fully implement email confirmation feature, your backend needs:

### New Endpoint: `sendApprovalEmail`

```http
POST /api/certificates
Content-Type: application/json

{
  "action": "sendApprovalEmail",
  "session": "admin_session_token",
  "id": "FORM-1234567890123-ABCDEF0123456789ABCDEF0123456789"
}
```

**Response:**
```json
{
  "ok": true,
  "submission": {
    "id": "FORM-...",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "flag": 1,
    "notification_status": "sent",
    "event_title": "Workshop Title",
    "created_at": "2026-11-20"
  }
}
```

**Error Response:**
```json
{
  "ok": false,
  "error": {
    "code": "EMAIL_FAILED",
    "message": "Email delivery service temporarily unavailable"
  }
}
```

### Implementation Notes:
1. Verify admin session is valid
2. Find certificate/submission by ID
3. Verify certificate is approved (flag = 1)
4. Send email to recipient with download link
5. Update `notification_status` to "sent"
6. Implement retry mechanism for failed emails
7. Return updated submission object

