import mongoose from 'mongoose';

const customTaskSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    telegramId: {
        type: Number,
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true
    },
    date: {
        type: String, // Формат YYYY-MM-DD
        required: true,
        index: true
    },
    isDone: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// TTL индекс: удаление кастомных задач через 120 дней (~4 месяца)
customTaskSchema.index({ createdAt: 1 }, { expireAfterSeconds: 10368000 });

const CustomTask = mongoose.model('CustomTask', customTaskSchema);
export default CustomTask;
