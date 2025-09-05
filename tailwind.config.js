/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./js/**/*.js"
  ],
  theme: {
    extend: {
      colors: {
        'chess-board': '#f4e4bc',
        'chess-line': '#8b4513',
        'river': '#87ceeb'
      },
      gridTemplateColumns: {
        '11': 'repeat(11, minmax(0, 1fr))',
      },
      gridTemplateRows: {
        '11': 'repeat(11, minmax(0, 1fr))',
      }
    },
  },
  plugins: [],
}
