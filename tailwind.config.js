/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.{html,js}"], // Busca en todos los HTML y JS dentro de public
  theme: {
    extend: {
      colors: {
        'brand-primary': '#2563EB', // Azul ejemplo (puedes cambiarlo)
        'brand-dark': '#1E293B',
      }
    },
  },
  plugins: [],
}