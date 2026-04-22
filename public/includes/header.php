<style>
    @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
    .animate-marquee { display: flex; width: max-content; animation: marquee 60s linear infinite; }
    .marquee-container:hover .animate-marquee { animation-play-state: paused; }
    .drawer-shadow { box-shadow: -10px 0 30px rgba(0,0,0,0.2); }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .menu-tab-btn.active { border-color: #00AEC7; color: #00AEC7; }
    .menu-tab-content.hidden { display: none; }
    .pb-safe { padding-bottom: env(safe-area-inset-bottom); }
    .animate-bounce-slow { animation: bounce 3s infinite; }
    .animate-in-up { animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes slideUp { from { transform: translateY(20px) scale(0.95); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
    .smooth-drawer { transition-property: transform, opacity, visibility; transition-duration: 500ms; transition-timing-function: cubic-bezier(0.19, 1, 0.22, 1); will-change: transform; }
    
    #toast-container { position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
    .toast { pointer-events: auto; background: white; padding: 12px 20px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); display: flex; items-center; gap: 12px; transform: translateX(100%); opacity: 0; transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); border-left: 4px solid #00AEC7; max-width: 350px; }
    .toast.show { transform: translateX(0); opacity: 1; }
    .toast.error { border-left-color: #EF4444; }
    .toast-icon { font-size: 18px; }
    .toast-msg { font-size: 12px; font-weight: 800; color: #171717; text-transform: uppercase; letter-spacing: 0.05em; }

    .search-dropdown { position: absolute; top: 100%; left: 0; width: 100%; background: white; border-radius: 0 0 20px 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); z-index: 50; overflow: hidden; display: none; margin-top: 2px; border: 1px solid #f3f4f6; }
    .search-dropdown.active { display: block; animation: slideDown 0.2s ease-out; }
    @keyframes slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
    .search-result-item { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid #f9fafb; cursor: pointer; transition: background 0.2s; }
    .search-result-item:hover { background-color: #f0fdfa; }
    .search-result-item:last-child { border-bottom: none; }
</style>

<div id="toast-container"></div>

<div class="fixed top-1/2 right-0 -translate-y-1/2 z-40 hidden md:flex flex-col gap-2 items-end">
    <a href="https://www.facebook.com/pixeltech.col" target="_blank" aria-label="Visitar nuestro Facebook" class="w-10 h-10 bg-[#1877F2] text-white flex items-center justify-center rounded-xl hover:scale-110 shadow-lg transition">
        <i class="fa-brands fa-facebook-f text-lg"></i>
    </a>
    <a href="https://www.instagram.com/pixeltech.col/" target="_blank" aria-label="Visitar nuestro Instagram" class="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 text-white flex items-center justify-center rounded-xl hover:scale-110 shadow-lg transition">
        <i class="fa-brands fa-instagram text-lg"></i>
    </a>
    <a href="https://www.tiktok.com/@pixeltech.col" target="_blank" aria-label="Visitar nuestro TikTok" class="w-10 h-10 bg-black text-white flex items-center justify-center rounded-xl hover:scale-110 shadow-lg transition">
        <i class="fa-brands fa-tiktok text-lg"></i>
    </a>
</div>

<div id="wa-overlay" class="fixed inset-0 z-[59] hidden" onclick="window.toggleWhatsAppModal()"></div>
<div id="wa-modal" class="fixed z-[60] hidden animate-in-up origin-bottom-right w-[90%] max-w-[380px] bottom-24 right-4 lg:w-[400px] lg:bottom-10 lg:right-24">
    <div class="bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-gray-100 relative">
        <div class="bg-gradient-to-r from-[#25D366] to-[#075E54] p-6 relative overflow-hidden">
            <i class="fa-brands fa-whatsapp absolute -bottom-4 -right-4 text-8xl text-white opacity-20 transform rotate-12"></i>
            <div class="relative z-10 flex justify-between items-start">
                <div><h3 class="font-black text-xl text-white tracking-tight">Hola, ¿En qué te ayudamos? 👋</h3><p class="text-green-100 text-xs font-medium mt-1">Selecciona un área para chatear ahora.</p></div>
                <button onclick="window.toggleWhatsAppModal()" class="bg-white/20 hover:bg-white/30 text-white rounded-full w-8 h-8 flex items-center justify-center transition backdrop-blur-sm"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
        <div class="p-5 space-y-3 bg-white">
            <a href="https://wa.me/573174534353" target="_blank" class="flex items-center gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100 hover:bg-green-50 hover:border-green-200 hover:shadow-md transition-all group cursor-pointer">
                <div class="w-12 h-12 rounded-full bg-white flex items-center justify-center text-green-500 shadow-sm group-hover:scale-110 transition border border-gray-100"><i class="fa-solid fa-headset text-lg"></i></div>
                <div><p class="font-black text-sm text-gray-800 uppercase tracking-wide group-hover:text-green-700 transition">Ventas Online 1</p><p class="text-[10px] text-gray-400 font-medium">Consultas y disponibilidad</p></div>
                <i class="fa-brands fa-whatsapp text-2xl text-gray-200 ml-auto group-hover:text-green-500 transition"></i>
            </a>
            <a href="https://wa.me/573009046450" target="_blank" class="flex items-center gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100 hover:bg-green-50 hover:border-green-200 hover:shadow-md transition-all group cursor-pointer">
                <div class="w-12 h-12 rounded-full bg-white flex items-center justify-center text-green-500 shadow-sm group-hover:scale-110 transition border border-gray-100"><i class="fa-solid fa-headset text-lg"></i></div>
                <div><p class="font-black text-sm text-gray-800 uppercase tracking-wide group-hover:text-green-700 transition">Ventas Online 2</p><p class="text-[10px] text-gray-400 font-medium">Consultas y disponibilidad</p></div>
                <i class="fa-brands fa-whatsapp text-2xl text-gray-200 ml-auto group-hover:text-green-500 transition"></i>
            </a>
            <a href="https://wa.me/573159834171" target="_blank" class="flex items-center gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100 hover:bg-blue-50 hover:border-blue-200 hover:shadow-md transition-all group cursor-pointer">
                <div class="w-12 h-12 rounded-full bg-white flex items-center justify-center text-blue-500 shadow-sm group-hover:scale-110 transition border border-gray-100"><i class="fa-solid fa-screwdriver-wrench text-lg"></i></div>
                <div><p class="font-black text-sm text-gray-800 uppercase tracking-wide group-hover:text-blue-700 transition">Soporte Técnico</p><p class="text-[10px] text-gray-400 font-medium">Garantías y ayuda</p></div>
                <i class="fa-brands fa-whatsapp text-2xl text-gray-200 ml-auto group-hover:text-blue-500 transition"></i>
            </a>
        </div>
        <div class="bg-gray-50 p-3 text-center border-t border-gray-100"><p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Respuesta habitual: &lt; 5 minutos</p></div>
    </div>
</div>

<button onclick="window.toggleWhatsAppModal()" aria-label="Abrir chat de WhatsApp" class="fixed bottom-24 lg:bottom-10 right-6 z-50 w-14 h-14 bg-[#25D366] text-white rounded-full shadow-xl flex items-center justify-center hover:scale-110 hover:shadow-2xl transition-all duration-300 group">
    <i class="fa-brands fa-whatsapp text-3xl group-hover:animate-none animate-bounce-slow"></i>
    <span class="absolute top-0 right-0 w-3.5 h-3.5 bg-red-500 rounded-full border-2 border-white animate-pulse"></span>
</button>

<div id="top-banner-dynamic" class="hidden lg:block bg-slate-950 text-gray-400 text-[10px] py-2 border-b border-white/5 overflow-hidden marquee-container">
    <div class="container mx-auto px-6 flex justify-center items-center">
        <i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i>
    </div>
</div>

<header class="bg-brand-black text-white py-4 md:py-5 sticky top-0 z-40 shadow-xl lg:shadow-2xl">
    <div class="container mx-auto px-4 md:px-6">
        <div class="flex items-center justify-between gap-4 md:gap-8">
            
            <a href="/" class="flex items-center group shrink-0 mx-auto lg:mx-0">
                <div class="relative flex items-center">
                    <div class="absolute inset-0 bg-brand-cyan/15 blur-2xl rounded-full group-hover:bg-brand-cyan/30 transition-all duration-500"></div>
                    <img src="/img/logo.webp" alt="PixelTech" width="160" height="64" class="h-12 md:h-16 lg:h-20 w-auto object-contain relative z-10 drop-shadow-[0_0_15px_rgba(0,229,255,0.2)]">
                </div>
            </a>

            <div class="hidden lg:block flex-grow max-w-2xl relative z-50">
                <div class="relative group">
                        <input type="text" id="search-desktop" aria-label="Buscar productos" autocomplete="off" placeholder="¿Qué equipo necesitas hoy?..." class="w-full bg-slate-900 border-2 border-slate-800 text-white px-6 py-4 pr-16 rounded-[2rem] focus:outline-none focus:border-brand-cyan transition shadow-inner">
                        <button aria-label="Realizar búsqueda" class="absolute right-2 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center text-gray-500 group-focus-within:text-brand-cyan hover:scale-110 transition cursor-pointer">
                            <i class="fa-solid fa-magnifying-glass text-xl"></i>
                        </button>
                    <div id="search-results-desktop" class="search-dropdown"></div>
                </div>
            </div>

            <div class="hidden lg:flex items-center gap-3 md:gap-6 shrink-0">
                <a href="https://wa.me/573009046450" target="_blank" class="flex flex-col items-center gap-1 group w-14">
                    <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:bg-green-500 group-hover:text-white transition duration-300"><i class="fa-brands fa-whatsapp text-xl"></i></div>
                    <span class="text-[8px] font-black uppercase tracking-widest text-gray-400 group-hover:text-green-500 text-center">Chat 1</span>
                </a>
                <a href="https://wa.me/573174534353" target="_blank" class="flex flex-col items-center gap-1 group w-14">
                    <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center group-hover:bg-green-500 group-hover:text-white transition duration-300"><i class="fa-brands fa-whatsapp text-xl"></i></div>
                    <span class="text-[8px] font-black uppercase tracking-widest text-gray-400 group-hover:text-green-500 text-center">Chat 2</span>
                </a>

                <div id="user-info-desktop" class="w-14"></div>
                
                <button onclick="window.toggleCartDrawer()" class="flex flex-col items-center gap-1 group w-14">
                    <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center relative group-hover:bg-brand-red group-hover:text-white transition duration-300">
                        <i class="fa-solid fa-cart-shopping text-xl text-white"></i>
                        <span id="cart-count-desktop" class="absolute -top-1.5 -right-1.5 bg-brand-red text-white text-[9px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-brand-black shadow-md z-10 hidden">0</span>
                    </div>
                    <span class="text-[8px] font-black uppercase tracking-widest text-gray-400 group-hover:text-brand-red text-center">Carrito</span>
                </button>
            </div>
        </div>
    </div>
</header>

<div class="lg:hidden bg-brand-black py-3 px-4 sticky top-[80px] z-30 border-t border-white/5 shadow-md">
    <div class="relative group z-50">
        <input type="text" id="search-mobile" autocomplete="off" placeholder="Buscar productos..." 
            class="w-full bg-slate-900 border-2 border-slate-800 text-white px-5 py-3 rounded-xl outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20 text-xs font-bold transition-all placeholder-gray-500 relative z-10">
        <i class="fa-solid fa-magnifying-glass absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm group-focus-within:text-brand-cyan z-20"></i>
        <div id="search-results-mobile" class="search-dropdown"></div>
    </div>
</div>

<nav class="hidden lg:block bg-brand-cyan py-3 shadow-lg z-30 relative border-b border-white/20">
    <div class="container mx-auto px-6">
        <ul class="flex gap-10 text-[11px] font-black uppercase tracking-[0.2em] justify-start overflow-x-auto no-scrollbar whitespace-nowrap text-white">
            <li><a href="/index.html" class="hover:text-brand-black transition duration-300">Inicio</a></li>
            <li><a href="/categories.html" class="hover:text-brand-black transition duration-300">Categorías</a></li>
            <li><a href="/brands.html" class="hover:text-brand-black transition duration-300">Marcas</a></li>
            <li><a href="/shop/catalog.html?mode=promos" class="hover:text-brand-black transition duration-300">Ofertas</a></li>
        </ul>
    </div>
</nav>

<nav class="lg:hidden fixed bottom-0 left-0 w-full bg-white/95 backdrop-blur-md border-t border-gray-100 z-50 flex justify-around items-center pb-safe shadow-[0_-5px_20px_rgba(0,0,0,0.05)]">
    <a href="/" class="nav-item flex flex-col items-center py-3 px-2 w-full text-gray-400 hover:text-brand-black active:text-brand-cyan transition">
        <i class="fa-solid fa-house text-xl mb-1"></i>
        <span class="text-[9px] font-bold">Inicio</span>
    </a>
    <button id="mobile-categories-btn" class="nav-item flex flex-col items-center py-3 px-2 w-full text-gray-400 hover:text-brand-black active:text-brand-cyan transition">
        <i class="fa-solid fa-layer-group text-xl mb-1"></i>
        <span class="text-[9px] font-bold">Categorías</span>
    </button>
    <button onclick="window.toggleCartDrawer()" class="nav-item relative flex flex-col items-center py-3 px-2 w-full text-gray-400 hover:text-brand-black active:text-brand-cyan transition">
        <div class="relative">
            <i class="fa-solid fa-cart-shopping text-xl mb-1"></i>
            <span id="cart-count-mobile" class="absolute -top-2 -right-2 bg-brand-red text-white text-[8px] font-black w-4 h-4 flex items-center justify-center rounded-full hidden">0</span>
        </div>
        <span class="text-[9px] font-bold">Carrito</span>
    </button>
    <a href="/profile.html" id="mobile-profile-link" class="nav-item flex flex-col items-center py-3 px-2 w-full text-gray-400 hover:text-brand-black active:text-brand-cyan transition">
        <i class="fa-regular fa-user text-xl mb-1"></i>
        <span class="text-[9px] font-bold">Perfil</span>
    </a>
    <button id="mobile-menu-btn" class="nav-item flex flex-col items-center py-3 px-2 w-full text-gray-400 hover:text-brand-black active:text-brand-cyan transition">
        <i class="fa-solid fa-bars text-xl mb-1"></i>
        <span class="text-[9px] font-bold">Menú</span>
    </button>
</nav>

<div id="mobile-menu-drawer" class="fixed inset-0 z-[100] translate-x-[-100%] transition-transform duration-300 ease-out lg:hidden">
    <div id="mobile-menu-overlay" class="absolute inset-0 bg-black/60 backdrop-blur-sm opacity-0 transition-opacity duration-300"></div>
    <div class="relative w-[85%] max-w-sm h-full bg-white flex flex-col shadow-2xl">
        <div class="p-6 bg-brand-black flex justify-between items-center shrink-0">
            <img src="/img/logo.webp" alt="PixelTech" width="120" height="40" class="h-10 w-auto opacity-90">
            <button id="mobile-drawer-close" aria-label="Cerrar menú móvil" class="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-brand-cyan hover:text-black transition">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        
        <div class="flex border-b border-gray-100 shrink-0">
            <button class="menu-tab-btn active flex-1 py-4 text-[10px] font-black uppercase tracking-widest border-b-2 border-transparent transition" data-tab="tab-categories">Categorías</button>
            <button class="menu-tab-btn flex-1 py-4 text-[10px] font-black uppercase tracking-widest border-b-2 border-transparent transition" data-tab="tab-menu">Mi Cuenta</button>
        </div>

        <div id="tab-categories" class="menu-tab-content active flex-grow overflow-y-auto p-4 space-y-2 no-scrollbar">
            <div id="categories-mobile-list" class="space-y-1"></div>
        </div>

        <div id="tab-menu" class="menu-tab-content hidden flex-grow overflow-y-auto p-6 space-y-6 no-scrollbar">
            
            <div class="space-y-2">
                <p class="text-[9px] font-black text-gray-300 uppercase tracking-widest mb-3">Panel de Usuario</p>
                
                <a href="/profile.html" class="flex items-center gap-4 p-3 rounded-xl bg-slate-50 border border-gray-100 hover:border-brand-cyan/30 transition group">
                    <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-brand-cyan shadow-sm border border-gray-50"><i class="fa-solid fa-box-open text-xs"></i></div>
                    <span class="font-bold text-xs text-brand-black uppercase tracking-tight group-hover:text-brand-cyan transition">Mis Pedidos</span>
                </a>

                <a href="/profile.html" class="flex items-center gap-4 p-3 rounded-xl bg-slate-50 border border-gray-100 hover:border-brand-cyan/30 transition group">
                    <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-brand-cyan shadow-sm border border-gray-50"><i class="fa-regular fa-id-card text-xs"></i></div>
                    <span class="font-bold text-xs text-brand-black uppercase tracking-tight group-hover:text-brand-cyan transition">Datos Personales</span>
                </a>

                <a href="/profile.html" class="flex items-center gap-4 p-3 rounded-xl bg-slate-50 border border-gray-100 hover:border-brand-cyan/30 transition group">
                    <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-brand-cyan shadow-sm border border-gray-50"><i class="fa-solid fa-map-location-dot text-xs"></i></div>
                    <span class="font-bold text-xs text-brand-black uppercase tracking-tight group-hover:text-brand-cyan transition">Direcciones</span>
                </a>
            </div>

            <div class="space-y-2 pt-2 border-t border-dashed border-gray-100">
                <p class="text-[9px] font-black text-gray-300 uppercase tracking-widest mb-3">Ayuda</p>
                <a href="#" onclick="window.toggleWhatsAppModal()" class="flex items-center gap-4 p-3 rounded-xl bg-green-50 border border-green-100 transition group">
                    <div class="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-green-500 shadow-sm"><i class="fa-brands fa-whatsapp text-sm"></i></div>
                    <span class="font-bold text-xs text-green-700 uppercase tracking-tight group-hover:text-green-800">Chat Soporte</span>
                </a>
            </div>

        </div>

        <div class="p-4 border-t border-gray-50 bg-gray-50/50 text-center shrink-0">
            <p class="text-[8px] font-black text-gray-300 uppercase tracking-[0.3em]">PixelTech v2.0</p>
        </div>
    </div>
</div>

<div id="cart-drawer-container" class="fixed inset-0 z-[100] pointer-events-none">
    <div id="cart-overlay" class="absolute inset-0 bg-black/60 backdrop-blur-sm opacity-0 transition-opacity duration-500 pointer-events-auto" style="display: none;" onclick="window.toggleCartDrawer()"></div>
    <div id="cart-drawer" class="absolute right-0 top-0 w-full max-w-[400px] h-full bg-white shadow-2xl flex flex-col drawer-shadow translate-x-full smooth-drawer pointer-events-auto">
        <div class="p-6 bg-white border-b border-gray-100 flex justify-between items-center z-10 relative">
            <h3 class="font-black text-lg uppercase tracking-tight flex items-center gap-3"><i class="fa-solid fa-bag-shopping text-brand-cyan"></i> Mi Carrito</h3>
            <button onclick="window.toggleCartDrawer()" aria-label="Cerrar carrito de compras" class="w-8 h-8 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center hover:bg-brand-red hover:text-white transition"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div id="cart-shipping-bar" class="px-6 py-3 bg-slate-50 border-b border-gray-100">
            <p id="shipping-msg" class="text-[9px] font-bold text-gray-500 uppercase tracking-wide text-center mb-2">Calculando envío...</p>
            <div class="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden"><div id="shipping-progress" class="h-full bg-brand-cyan transition-all duration-500 w-0"></div></div>
        </div>
        <div id="cart-drawer-items" class="flex-grow overflow-y-auto p-6 space-y-4 no-scrollbar relative"></div>
        <div class="p-6 border-t border-gray-100 bg-white z-10 relative">
            <div class="flex justify-between items-end mb-4"><span class="text-[10px] font-black uppercase text-gray-400 tracking-widest">Subtotal</span><span id="cart-drawer-total" class="text-2xl font-black text-brand-black tracking-tight">$0</span></div>
            <div class="grid grid-cols-2 gap-3">
                <a href="/shop/cart.html" class="py-4 rounded-xl border border-gray-200 text-brand-black font-black uppercase text-[10px] tracking-widest flex items-center justify-center hover:border-brand-black transition">Ver Carrito</a>
                <button id="btn-checkout-drawer" onclick="window.location.href='/shop/checkout.html'" class="py-4 rounded-xl bg-brand-black text-white font-black uppercase text-[10px] tracking-widest flex items-center justify-center hover:bg-brand-cyan hover:text-brand-black transition shadow-lg shadow-cyan-500/10">Pagar Ahora</button>
            </div>
        </div>
    </div>
</div>