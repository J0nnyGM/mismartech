<section class="w-full px-4 md:px-[3%] pt-4 md:pt-6">
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 h-auto lg:h-[60vh] lg:min-h-[550px] xl:min-h-[650px]">
        
        <div class="lg:col-span-4 relative rounded-[2rem] md:rounded-[2.5rem] overflow-hidden shadow-xl bg-slate-900 group h-[50vh] min-h-[350px] lg:h-full lg:min-h-full">
            <div id="promo-slider-container" class="h-full w-full relative bg-slate-900">
                <div class="absolute inset-0 w-full h-full promo-slide opacity-100 z-10 flex items-center justify-center">
                    <img src="/img/logo.webp" fetchpriority="high" decoding="sync" alt="Bienvenidos a PixelTech" class="absolute inset-0 w-full h-full object-contain opacity-20 p-10">
                    <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/80 to-transparent"></div>
                    <div class="relative z-10 p-6 md:p-8 h-full w-full flex flex-col justify-end items-center md:items-start text-center md:text-left">
                        <span class="bg-brand-cyan text-brand-black text-[8px] font-black px-3 py-1 rounded-full mb-3 uppercase tracking-widest shadow-lg shadow-cyan-500/20">Bienvenidos a PixelTech</span>
                        <h2 class="text-lg md:text-xl font-black text-white uppercase tracking-tighter line-clamp-2 leading-tight">Cargando las mejores ofertas...</h2>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="lg:col-span-8 grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-10 gap-4 md:gap-6 h-auto lg:h-full">
            <div id="new-launch-banner" class="hidden lg:block relative rounded-[2.5rem] overflow-hidden shadow-2xl bg-slate-900 lg:h-full lg:row-span-7">
                <div class="flex flex-col items-center justify-center h-full text-brand-cyan opacity-50">
                    <i class="fa-solid fa-circle-notch fa-spin text-3xl mb-2"></i>
                </div>
            </div>
            
            <div class="bg-white rounded-[2rem] md:rounded-[2.5rem] shadow-lg border border-gray-100 p-4 md:p-5 flex flex-col h-auto lg:h-full lg:row-span-7 relative z-20 overflow-hidden">
                <div class="flex items-center gap-2 mb-2 shrink-0"><div class="w-1.5 h-5 bg-brand-cyan rounded-full"></div><h3 class="font-black text-xs md:text-sm uppercase tracking-widest text-brand-black">Elección Semanal</h3></div>
                <div id="weekly-choice-container" class="flex-grow space-y-2 overflow-y-auto no-scrollbar pr-1">
                    <?php for($i=0; $i<4; $i++): ?>
                    <div class="flex items-center gap-3 p-2 rounded-xl border border-gray-100 animate-pulse h-[80px] w-full">
                        <div class="w-14 h-14 bg-gray-200 rounded-lg shrink-0"></div>
                        <div class="flex-grow space-y-2">
                            <div class="h-2 bg-gray-200 rounded w-1/4"></div>
                            <div class="h-3 bg-gray-200 rounded w-3/4"></div>
                            <div class="h-3 bg-gray-200 rounded w-1/3"></div>
                        </div>
                    </div>
                    <?php endfor; ?>
                </div>
            </div>
            
            <div class="lg:col-span-2 lg:row-span-3 bg-slate-50 rounded-[2rem] md:rounded-[2.5rem] border border-gray-100 p-3 md:p-4 flex flex-col justify-between h-fit lg:h-full relative group-history z-10">
                <div class="flex items-center justify-between mb-1 px-2 shrink-0"><h3 class="font-black text-[9px] uppercase tracking-[0.2em] text-gray-400">Visto recientemente</h3><div class="h-px bg-gray-200 flex-grow mx-4"></div></div>
                <div class="relative w-full flex items-center justify-center flex-grow h-full">
                    <button id="hist-btn-left" aria-label="Ver historial anterior" class="hidden md:flex absolute -left-2 z-20 w-7 h-7 bg-white border border-gray-100 rounded-full shadow-md items-center justify-center text-brand-black hover:bg-brand-black hover:text-brand-cyan transition"><i class="fa-solid fa-chevron-left text-[10px]"></i></button>
                    <div id="view-history-list" class="flex gap-3 overflow-x-auto no-scrollbar smooth-scroll px-1 py-1 items-center h-full w-full">
                        <p class="text-[9px] text-gray-400 font-bold uppercase w-full text-center self-center">Explora productos para ver tu historial</p>
                    </div>
                    <button id="hist-btn-right" aria-label="Ver historial siguiente" class="hidden md:flex absolute -right-2 z-20 w-7 h-7 bg-white border border-gray-100 rounded-full shadow-md items-center justify-center text-brand-black hover:bg-brand-black hover:text-brand-cyan transition"><i class="fa-solid fa-chevron-right text-[10px]"></i></button>
                </div>
            </div>
        </div>
    </div>
</section>