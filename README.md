# ThinkLess Planner

**A productivity planner that helps you stop overthinking and start doing.**

ThinkLess Planner is a smart, interactive task scheduler built with vanilla HTML, CSS, and JavaScript. Designed for students and professionals, it eliminates procrastination and decision fatigue by intelligently finding the perfect free-time slots for your most critical tasks.

## 🚀 Features

*   **Smart Scheduling Dashboard**: Intelligently assigns tasks to your available free time based on estimated duration, priority level, and required energy.
*   **Procrastination & Momentum Tracking**: Monitors delayed tasks, dynamically calculates a procrastination score, and tracks your daily productivity streaks.
*   **Weekly Timetable Grid**: Fully scrollable 24-hour visualization of your weekly schedule, plotting both tasks and free-time blocks.
*   **Pomodoro Focus Mode**: A dedicated focus screen to isolate a single task, complete with a built-in Pomodoro timer to maximize concentration.
*   **Regret Simulator**: An advanced feature that visualizes the "domino effect" of delaying a task versus completing it on time.
*   **Recurring Tasks & Slots**: Easily set up repeating tasks (like study sessions) and recurring free-time blocks (like lunch breaks) for specific days of the week.
*   **Aesthetic UI & Themes**: Clean, modern, glassmorphism-inspired design with switchable aesthetic themes (Calm Blue, Energetic Orange, Relaxed Purple).

## 🛠️ Technology Stack

*   **HTML5**: Semantic structure.
*   **CSS3**: Vanilla CSS with modern flexbox/grid layouts, custom properties (variables) for theme switching, and smooth animations.
*   **JavaScript (ES6+)**: Pure vanilla JS handling all state management, scheduling logic, and DOM manipulation utilizing `localStorage` to persist your data locally.

## 🔥 Quick Start

Since ThinkLess Planner is fully client-side and relies on `localStorage`, there is no complex backend to configure!

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/thinkless-planner.git
    cd thinkless-planner
    ```

2.  **Run a local server:**
    You can use any basic HTTP server. For example, using Node.js `npx`:
    ```bash
    npx serve .
    ```

3.  **Open in Browser:**
    Navigate to `http://localhost:3000` to start organizing your focus.

## 💡 How It Works

1.  **Add Free Time**: Input blocks of time when you are available to work (e.g., 2 PM - 4 PM) and select your expected energy level for that slot.
2.  **Add Tasks**: Input tasks with their deadlines, estimated completion times, priority, and required energy.
3.  **Let the App Think**: ThinkLess Planner sorts tasks by a calculated urgency score (deadline proximity + importance) and automatically slots them into times where your available energy matches the task's demands.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! 
Feel free to check the [issues page](https://github.com/yourusername/thinkless-planner/issues).

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.
