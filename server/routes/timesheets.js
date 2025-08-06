const express = require('express');
const Timesheet = require('../models/Timesheet');
const { auth } = require('../middleware/auth');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');

const router = express.Router();

// Get user's timesheets (with optional filters)
router.get('/', auth, async (req, res) => {
  try {
    const { status, startDate, endDate } = req.query;
    const query = { employee: req.user._id };

    if (status && status !== 'all') {
      query.status = status;
    }

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const timesheets = await Timesheet.find(query)
      .sort({ date: -1 })
      .populate('reviewedBy', 'name');

    res.json(timesheets);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new timesheet
router.post('/', auth, async (req, res) => {
  try {
    const { date, plannedWork, actualWork, remarks } = req.body;

    // Check if timesheet already exists for the given date
    const existing = await Timesheet.findOne({
      employee: req.user._id,
      date: new Date(date)
    });

    if (existing) {
      return res.status(400).json({ message: 'Timesheet already exists for this date' });
    }

    const timesheet = new Timesheet({
      employee: req.user._id,
      employeeName: req.user.name,
      date: new Date(date),
      plannedWork,
      actualWork,
      remarks
    });

    await timesheet.save();
    res.status(201).json(timesheet);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update timesheet (allowed for 'pending' or 'rejected' statuses)
router.put('/:id', auth, async (req, res) => {
  try {
    const { plannedWork, actualWork, remarks } = req.body;

    const timesheet = await Timesheet.findOne({
      _id: req.params.id,
      employee: req.user._id
    });

    if (!timesheet) {
      return res.status(404).json({ message: 'Timesheet not found' });
    }

    if (timesheet.status !== 'pending' && timesheet.status !== 'rejected') {
      return res.status(400).json({ message: 'Only pending or rejected timesheets can be edited' });
    }

    timesheet.plannedWork = plannedWork;
    timesheet.actualWork = actualWork;
    timesheet.remarks = remarks;

    await timesheet.save();
    res.json(timesheet);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete timesheet (only if still pending)
router.delete('/:id', auth, async (req, res) => {
  try {
    const timesheet = await Timesheet.findOne({
      _id: req.params.id,
      employee: req.user._id
    });

    if (!timesheet) {
      return res.status(404).json({ message: 'Timesheet not found' });
    }

    if (timesheet.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending timesheets can be deleted' });
    }

    await Timesheet.findByIdAndDelete(req.params.id);
    res.json({ message: 'Timesheet deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Export timesheets as CSV
router.get('/export/csv', auth, async (req, res) => {
  try {
    const timesheets = await Timesheet.find({ employee: req.user._id }).sort({ date: -1 });

    const fields = ['employeeName', 'date', 'plannedWork', 'actualWork', 'remarks', 'status', 'adminComments'];
    const opts = { fields };

    const parser = new Parser(opts);
    const csv = parser.parse(timesheets);

    res.header('Content-Type', 'text/csv');
    res.attachment('timesheets.csv');
    res.send(csv);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to export CSV' });
  }
});

// Export timesheets as PDF
router.get('/export/pdf', auth, async (req, res) => {
  try {
    const timesheets = await Timesheet.find({ employee: req.user._id }).sort({ date: -1 });

    const doc = new PDFDocument();
    const filename = encodeURIComponent('timesheets.pdf');

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');

    doc.pipe(res);
    doc.fontSize(20).text('Timesheet Report', { align: 'center' });
    doc.moveDown();

    timesheets.forEach((ts, index) => {
      doc
        .fontSize(12)
        .text(`Entry #${index + 1}`)
        .text(`Employee: ${ts.employeeName}`)
        .text(`Date: ${new Date(ts.date).toLocaleDateString()}`)
        .text(`Planned Work: ${ts.plannedWork}`)
        .text(`Actual Work: ${ts.actualWork}`)
        .text(`Remarks: ${ts.remarks || 'None'}`)
        .text(`Status: ${ts.status}`)
        .moveDown();
    });

    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to generate PDF' });
  }
});

// Export timesheets as PDF for employee
router.get('/download-pdf', auth, async (req, res) => {
  try {
    const timesheets = await Timesheet.find({ employee: req.user.id }).sort({ date: 1 });

    if (!timesheets.length) {
      return res.status(404).json({ message: 'No timesheets found.' });
    }

    
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="timesheets.pdf"');
    doc.pipe(res);

    doc.fontSize(16).text(`Timesheets for ${req.user.name}`, { align: 'center' });
    doc.moveDown();

    timesheets.forEach((ts, index) => {
      doc
        .fontSize(12)
        .text(`Date: ${new Date(ts.date).toDateString()}`)
        .text(`Planned Work: ${ts.plannedWork}`)
        .text(`Actual Work: ${ts.actualWork}`)
        .text(`Remarks: ${ts.remarks || '-'}`)
        .text(`Status: ${ts.status}`)
        .text(`Admin Comments: ${ts.adminComments || '-'}`);
      doc.moveDown();
      if (index < timesheets.length - 1) doc.moveDown();
    });

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ message: 'PDF generation failed' });
  }
});


module.exports = router;
