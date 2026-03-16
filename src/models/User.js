import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    telegramId: {
        type: Number,
        required: true,
        unique: true,
    },
    username: {
        type: String,
        default: '',
    },
    currentWeek: {
        type: Number,
        default: 1,
    },
    currentDay: {
        type: Number,
        default: 1,
    },
    frozen: {
        type: Boolean,
        default: false,
    },
    goals: {
        type: [String],
        default: [],
    },
    progress: {
        type: Map,
        of: Boolean,
        default: {}
    },
    strikes: {
        type: Number,
        default: 0
    },
    tails: {
        type: [String], // "хвосты"
        default: [],
    },
    isRegistered: {
        type: Boolean,
        default: false
    },
    timezone: {
        type: String,
        default: 'Europe/Kyiv'
    },
    isAskingHelp: {
        type: Boolean,
        default: false
    },
    isMessagingAdmin: {
        type: Boolean,
        default: false
    },
    socialCapitalEur: {
        type: Number,
        default: 0
    },
    auditBeliefsCount: {
        type: Number,
        default: 0
    },
    hasMentor: {
        type: Boolean,
        default: false
    },
    followersCount: {
        type: Number,
        default: 0
    },
    completedGlobalTasks: {
        type: [String],
        default: []
    },
    unfreezeDate: {
        type: Date,
        default: null
    },
    totalRoutineDays: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true,
});

const User = mongoose.model('User', userSchema);
export default User;
