import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    week: {
        type: Number,
        required: true,
    },
    day: {
        type: Number,
        required: true,
    },
    text: {
        type: String,
        required: true,
    },
    photoIds: {
        type: [String],
        default: [],
    },
    geminiFeedback: {
        type: String,
        default: '',
    },
    status: {
        type: String, // e.g., 'pending', 'approved', 'rejected'
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    }
}, {
    timestamps: true,
});

const Report = mongoose.model('Report', reportSchema);
export default Report;
