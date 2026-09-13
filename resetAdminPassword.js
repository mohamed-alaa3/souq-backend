require("dotenv").config();

const mongoose = require("mongoose");
const User = require("./models/User");

const resetAdminPassword = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const admin = await User.findOne({ email: "admin@souq.com" });

    if (!admin) {
      console.log("Admin not found");
      return;
    }

    admin.password = "Admin123456";
    await admin.save();

    console.log("Admin password reset successfully!");
    console.log("Email: admin@souq.com");
    console.log("New Password: Admin123456");

    await mongoose.connection.close();
  } catch (error) {
    console.error("Error:", error.message);
    await mongoose.connection.close();
  }
};

resetAdminPassword();
