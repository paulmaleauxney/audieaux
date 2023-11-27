<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AUDIEAUX Website</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            overflow: hidden;
        }

        header {
            background-color: #333;
            color: white;
            text-align: center;
            padding: 20px;
            position: relative;
        }

        #banner {
            font-size: 2em;
            margin-bottom: 20px;
        }

        #musicalNotes {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
            pointer-events: none;
        }

        @keyframes float {
            0% {
                transform: translateY(0);
            }
            50% {
                transform: translateY(-20px);
            }
            100% {
                transform: translateY(0);
            }
        }

        .note {
            position: absolute;
            font-size: 2em;
            animation: float 3s infinite;
        }

        /* Add more styles and animations as needed */
    </style>
</head>
<body>

    <header>
        <div id="banner">AUDIEAUX</div>
        <div id="musicalNotes">
            <!-- Add musical notes dynamically using JavaScript -->
        </div>
    </header>

    <script>
        // JavaScript to dynamically create and float musical notes
        const musicalNotesContainer = document.getElementById('musicalNotes');

        function createNote() {
            const note = document.createElement('div');
            note.className = 'note';
            note.innerHTML = '&#9835;'; // Unicode musical note symbol
            note.style.left = `${Math.random() * 100}vw`; // Random horizontal position
            note.style.animationDuration = `${Math.random() * 2 + 1}s`; // Random duration
            musicalNotesContainer.appendChild(note);
        }

        // Create initial set of notes
        for (let i = 0; i < 10; i++) {
            createNote();
        }

        // Add more notes every few seconds (adjust as needed)
        setInterval(createNote, 5000);
    </script>

</body>
</html>
