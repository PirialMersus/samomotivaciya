import mongoose from 'mongoose';

const connectDB = async () => {
    let attempts = 5;
    while (attempts > 0) {
        try {
            const connectionInstance = await mongoose.connect(process.env.MONGODB_URI);
            console.log(`MongoDB Connected: ${connectionInstance.connection.host}`);
            return;
        } catch (error) {
            attempts -= 1;
            console.error(`Error connecting to MongoDB: ${error.message}. Remaining attempts: ${attempts}`);
            if (attempts === 0) {
                process.exit(1);
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
};

export default connectDB;
