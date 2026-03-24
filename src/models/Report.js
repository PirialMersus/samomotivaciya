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
        type: String, // e.g., 'pending', 'approved_daily', 'approved_task', 'chat', 'rejected'
        enum: ['pending', 'approved', 'rejected', 'approved_daily', 'approved_task', 'chat'],
        default: 'pending'
    }
}, {
    timestamps: true,
});

// TTL индекс: удаление отчетов через 120 дней (~4 месяца)
reportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 10368000 });

const Report = mongoose.model('Report', reportSchema);
export default Report;
