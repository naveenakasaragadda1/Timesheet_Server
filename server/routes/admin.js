const express = require('express');
const User = require('../models/User');
const Timesheet = require('../models/Timesheet');
const { adminAuth } = require('../middleware/auth');
const { Parser } = require('json2csv');

const jwt = require('jsonwebtoken');

const PDFDocument = require('pdfkit'); 

const router = express.Router();

// ✅ Get all employees
router.get('/employees', adminAuth, async (req, res) => {
  try {
    const employees = await User.find({ role: 'employee' })
      .select('-password')
      .sort({ name: 1 });
    res.json(employees);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Create employee
router.post('/employees', adminAuth, async (req, res) => {
  try {
    const { name, email, password, employeeId, department } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    const employee = new User({
      name,
      email,
      password,
      employeeId,
      department,
      role: 'employee'
    });

    await employee.save();

    const employeeData = employee.toObject();
    delete employeeData.password;

    res.status(201).json(employeeData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Update employee
router.put('/employees/:id', adminAuth, async (req, res) => {
  try {
    const { name, email, employeeId, department, isActive } = req.body;

    const employee = await User.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    employee.name = name;
    employee.email = email;
    employee.employeeId = employeeId;
    employee.department = department;
    employee.isActive = isActive;

    await employee.save();

    const employeeData = employee.toObject();
    delete employeeData.password;

    res.json(employeeData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Delete employee
router.delete('/employees/:id', adminAuth, async (req, res) => {
  try {
    const employee = await User.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    await User.findByIdAndDelete(req.params.id);
    await Timesheet.deleteMany({ employee: req.params.id });

    res.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Get all timesheets with filters
router.get('/timesheets', adminAuth, async (req, res) => {
  try {
    const { employee, status, startDate, endDate, search } = req.query;
    let query = {};

    if (employee && employee !== 'all') {
      query.employee = employee;
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (search) {
      query.$or = [
        { employeeName: { $regex: search, $options: 'i' } },
        { plannedWork: { $regex: search, $options: 'i' } },
        { actualWork: { $regex: search, $options: 'i' } }
      ];
    }

    const timesheets = await Timesheet.find(query)
      .populate('employee', 'name email employeeId department')
      .populate('reviewedBy', 'name')
      .sort({ date: -1 });

    res.json(timesheets);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Review timesheet (accept/reject)
router.put('/timesheets/:id/review', adminAuth, async (req, res) => {
  try {
    const { status, adminComments } = req.body;

    const timesheet = await Timesheet.findById(req.params.id);
    if (!timesheet) {
      return res.status(404).json({ message: 'Timesheet not found' });
    }

    timesheet.status = status;
    timesheet.adminComments = adminComments;
    timesheet.reviewedBy = req.user._id;
    timesheet.reviewedAt = new Date();

    await timesheet.save();

    const populatedTimesheet = await Timesheet.findById(timesheet._id)
      .populate('employee', 'name email employeeId department')
      .populate('reviewedBy', 'name');

    res.json(populatedTimesheet);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Export all timesheets as CSV
router.get('/timesheets/export/csv', adminAuth, async (req, res) => {
  try {
    const timesheets = await Timesheet.find({})
      .populate('employee', 'name email employeeId department')
      .sort({ date: -1 });

    const data = timesheets.map(t => ({
      employeeName: t.employeeName,
      employeeEmail: t.employee?.email || '',
      employeeId: t.employee?.employeeId || '',
      department: t.employee?.department || '',
      date: t.date.toISOString().split('T')[0],
      plannedWork: t.plannedWork,
      actualWork: t.actualWork,
      remarks: t.remarks,
      status: t.status,
      adminComments: t.adminComments
    }));

    const fields = ['employeeName', 'employeeEmail', 'employeeId', 'department', 'date', 'plannedWork', 'actualWork', 'remarks', 'status', 'adminComments'];
    const opts = { fields };

    const parser = new Parser(opts);
    const csv = parser.parse(data);

    res.header('Content-Type', 'text/csv');
    res.attachment('all-timesheets.csv');
    res.send(csv);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ Admin Dashboard Stats — CORRECTLY PLACED OUTSIDE other routes
router.get('/dashboard', adminAuth, async (req, res) => {
  try {
    const totalTimesheets = await Timesheet.countDocuments();
    const pending = await Timesheet.countDocuments({ status: 'pending' });
    const accepted = await Timesheet.countDocuments({ status: 'accepted' });
    const rejected = await Timesheet.countDocuments({ status: 'rejected' });

    const totalEmployees = await User.countDocuments({ role: 'employee' });

    res.json({
      totalTimesheets,
      pending,
      accepted,
      rejected,
      totalEmployees,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// Download a single timesheet as PDF
router.get('/timesheets/:id/download', adminAuth, async (req, res) => {
  try {
    const timesheet = await Timesheet.findById(req.params.id).populate('employee', 'name email');

    if (!timesheet) {
      return res.status(404).json({ message: 'Timesheet not found' });
    }

    const doc = new PDFDocument();
    const filename = `timesheet-${timesheet._id}.pdf`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    doc.pipe(res);

    doc.fontSize(18).text('Timesheet Details', { align: 'center' }).moveDown();
    doc.fontSize(12)
      .text(`Employee Name: ${timesheet.employeeName}`)
      .text(`Date: ${new Date(timesheet.date).toLocaleDateString()}`)
      .text(`Planned Work: ${timesheet.plannedWork}`)
      .text(`Actual Work: ${timesheet.actualWork}`)
      .text(`Remarks: ${timesheet.remarks || 'None'}`)
      .text(`Status: ${timesheet.status}`)
      .text(`Admin Comments: ${timesheet.adminComments || 'None'}`);

    doc.end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to download timesheet' });
  }
});

// Download individual timesheet as PDF
router.get('/timesheets/:id/export/pdf', adminAuth, async (req, res) => {
  try {
    const timesheet = await Timesheet.findById(req.params.id);
    if (!timesheet) return res.status(404).json({ message: 'Not found' });

    const doc = new PDFDocument();
    const filename = `Timesheet_${timesheet.employeeName}_${new Date(timesheet.date).toISOString().split('T')[0]}.pdf`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');

    doc.pipe(res);
    doc.fontSize(20).text('Timesheet Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Employee: ${timesheet.employeeName}`);
    doc.text(`Date: ${new Date(timesheet.date).toLocaleDateString()}`);
    doc.text(`Planned Work: ${timesheet.plannedWork}`);
    doc.text(`Actual Work: ${timesheet.actualWork}`);
    doc.text(`Remarks: ${timesheet.remarks}`);
    doc.text(`Status: ${timesheet.status}`);
    if (timesheet.adminComments) {
      doc.text(`Admin Comments: ${timesheet.adminComments}`);
    }
    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to generate PDF' });
  }
});

// Export all filtered timesheets (CSV)
router.get('/timesheets/export/csv', adminAuth, async (req, res) => {
  try {
    const { employee, date, month } = req.query;
    const query = {};

    if (employee) query.employee = employee;
    if (date) query.date = new Date(date);
    if (month) {
      const [year, mon] = month.split('-');
      const start = new Date(year, mon - 1, 1);
      const end = new Date(year, mon, 0);
      query.date = { $gte: start, $lte: end };
    }

    const timesheets = await Timesheet.find(query).sort({ date: -1 });

    const fields = ['employeeName', 'date', 'plannedWork', 'actualWork', 'remarks', 'status', 'adminComments'];
    const parser = new Parser({ fields });
    const csv = parser.parse(timesheets);

    res.header('Content-Type', 'text/csv');
    res.attachment('filtered_timesheets.csv');
    res.send(csv);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'CSV export failed' });
  }
});


// Filtered export for a specific employee (CSV/PDF)
router.get('/timesheets/export', adminAuth, async (req, res) => {
  try {
    const { employeeId, format, startDate, endDate } = req.query;

    if (!employeeId || !format) {
      return res.status(400).json({ message: 'Employee ID and format are required' });
    }

    let query = { employee: employeeId };

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const timesheets = await Timesheet.find(query).sort({ date: -1 });

    if (format === 'csv') {
      const fields = ['employeeName', 'date', 'plannedWork', 'actualWork', 'remarks', 'status', 'adminComments'];
      const parser = new Parser({ fields });
      const csv = parser.parse(timesheets);

      res.header('Content-Type', 'text/csv');
      res.attachment('filtered_timesheets.csv');
      return res.send(csv);
    }

    if (format === 'pdf') {
      const doc = new PDFDocument();
      const filename = `filtered_timesheets.pdf`;

      res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-type', 'application/pdf');

      doc.pipe(res);
      doc.fontSize(18).text('Filtered Timesheets Report', { align: 'center' }).moveDown();

      timesheets.forEach((ts, i) => {
        doc.fontSize(12)
          .text(`Date: ${new Date(ts.date).toLocaleDateString()}`)
          .text(`Planned: ${ts.plannedWork}`)
          .text(`Actual: ${ts.actualWork}`)
          .text(`Remarks: ${ts.remarks}`)
          .text(`Status: ${ts.status}`)
          .text(`Comments: ${ts.adminComments || '-'}`)
          .moveDown();
      });

      doc.end();
    } else {
      res.status(400).json({ message: 'Invalid format' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to export timesheets' });
  }
});

router.get('/timesheets/:id/export/pdf', async (req, res) => {
  try {
    let token;

    // Try to extract token from Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Fallback: allow token via query param
    if (!token && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    const timesheet = await Timesheet.findById(req.params.id);
    if (!timesheet) {
      return res.status(404).json({ message: 'Timesheet not found' });
    }

    // Generate simple PDF
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=timesheet-${req.params.id}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).text('Timesheet Details', { underline: true });
    doc.moveDown();
    doc.fontSize(14).text(`Employee: ${timesheet.employeeName}`);
    doc.text(`Date: ${new Date(timesheet.date).toLocaleDateString()}`);
    doc.text(`Planned Work: ${timesheet.plannedWork}`);
    doc.text(`Actual Work: ${timesheet.actualWork}`);
    doc.text(`Remarks: ${timesheet.remarks}`);
    doc.text(`Status: ${timesheet.status}`);
    if (timesheet.adminComments) {
      doc.text(`Admin Comments: ${timesheet.adminComments}`);
    }

    doc.end();
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: 'Token is not valid' });
  }
});


router.get('/timesheets/export/csv', adminAuth, async (req, res) => {
  try {
    const { employee, startDate, endDate } = req.query;
    let query = {};

    if (employee && employee !== 'all') {
      query.employee = employee;
    }

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const timesheets = await Timesheet.find(query)
      .populate('employee', 'name email employeeId department')
      .sort({ date: -1 });

    const data = timesheets.map(t => ({
      employeeName: t.employee?.name || t.employeeName,
      employeeEmail: t.employee?.email || '',
      employeeId: t.employee?.employeeId || '',
      department: t.employee?.department || '',
      date: t.date.toISOString().split('T')[0],
      plannedWork: t.plannedWork,
      actualWork: t.actualWork,
      remarks: t.remarks,
      status: t.status,
      adminComments: t.adminComments || '',
    }));

    const fields = [
      'employeeName',
      'employeeEmail',
      'employeeId',
      'department',
      'date',
      'plannedWork',
      'actualWork',
      'remarks',
      'status',
      'adminComments'
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(data);

    res.header('Content-Type', 'text/csv');
    res.attachment('filtered_timesheets.csv');
    res.send(csv);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to export CSV' });
  }
});





module.exports = router;
