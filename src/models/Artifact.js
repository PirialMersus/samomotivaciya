import mongoose from 'mongoose';

const artifactSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['desires100', 'smartGoals10', 'strategicGoals', 'tacticalGoals', 'contractText', 'analysisOfCurrentSituation', 'weeklyReport'],
        required: true,
        index: true
    },
    value: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    }
}, {
    timestamps: true
});

// TTL: Срок жизни каждого артефакта — 120 дней (~4 месяца) после последнего обновления
artifactSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 10368000 });

const Artifact = mongoose.model('Artifact', artifactSchema);
export default Artifact;
