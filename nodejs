const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// Set up a storage engine using multer
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.static('public'));

// Serve the HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'record.html'));
});

// Handle the audio file upload
app.post('/upload', upload.single('audio'), (req, res) => {
    try {
        const audioBuffer = req.file.buffer;
        const audioFilePath = path.join(__dirname, 'uploads', `audio_${Date.now()}.wav`);

        fs.writeFileSync(audioFilePath, audioBuffer);
        
        console.log('Audio file saved:', audioFilePath);

        res.json({ success: true, message: 'Audio file saved successfully' });
    } catch (error) {
        console.error('Error saving audio file:', error);
        res.status(500).json({ success: false, message: 'Error saving audio file' });
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});
