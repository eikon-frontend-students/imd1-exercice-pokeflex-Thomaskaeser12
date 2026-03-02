// IIFE: on place tout le code dans une fonction qui s'exécute immédiatement (évite les variables globales)
(function () {
  // début de la fonction exécutée tout de suite
  "use strict"; // active le mode strict pour attraper des erreurs simples

  // --- CONFIGURATION ---
  const DEFAULT_POKEMON = "Pikachu"; // Pokémon affiché par défaut
  const API_POKEBUILD = "https://pokebuildapi.fr/api/v1/pokemon/"; // base API Pokebuild
  const API_TCGDEX = "https://api.tcgdex.net/v2/fr"; // base API TCGDex
  const HISTORY_KEY = "poke_history_v2"; // clé localStorage pour l'historique
  const STATS_KEY = "poke_stats_v2"; // clé localStorage pour les stats
  const MAX_CANDIDATES = 50; // limite de cartes TCG à inspecter

  let currentPokemon = DEFAULT_POKEMON; // nom du pokémon courant

  // objet qui contiendra les références aux éléments HTML (pratique pour l'accès)
  const ui = {
    searchForm: null, // formulaire de recherche
    pokemonInput: null, // input texte
    rarityFilter: null, // select rareté
    errorMessage: null, // zone d'affichage d'erreurs
    cardsContainer: null, // conteneur où insérer la carte
    cardTemplate: null, // template HTML (<template>) à cloner
    clearHistoryBtn: null, // bouton clear
    randomContainer: null, // conteneur miniatures aléatoires
    randomSearchBtn: null, // bouton recherche aléatoire
    topContainer: null, // conteneur top 5
    historyContainer: null, // conteneur historique
  };

  // attend que le DOM soit prêt pour initialiser
  document.addEventListener("DOMContentLoaded", () => {
    initElements(); // lie les éléments DOM dans ui
    initEvents(); // attache les écouteurs
    renderHistory(); // affiche l'historique stocké
    renderTopFive(); // affiche le top 5 des vues
    executeSearch(DEFAULT_POKEMON); // lance la recherche par défaut
    // Note: loadRandomSuggestions est maintenant géré par executeSearch
  });

  // récupère toutes les références DOM utiles et les stocke dans ui
  function initElements() {
    ui.searchForm = document.getElementById("search-form");
    ui.pokemonInput = document.getElementById("pokemon-input");
    ui.rarityFilter = document.getElementById("rarity-filter");
    ui.aspectFilter = document.getElementById("aspect-filter");
    ui.errorMessage = document.getElementById("error-message");
    ui.cardsContainer = document.getElementById("cards-container");
    ui.cardTemplate = document.getElementById("pokemon-card-template");
    ui.clearHistoryBtn = document.getElementById("clear-history");
    ui.randomContainer = document.getElementById("random-pokemon-container");
    ui.topContainer = document.getElementById("top-pokemon-container");
    ui.randomSearchBtn = document.getElementById("random-search-btn");
    ui.historyContainer = document.getElementById("search-history");
  }

  // attache les événements (submit, change, scroll, click)
  function initEvents() {
    window.addEventListener("scroll", handleHeaderScroll); // gère l'affichage du header lors du scroll

    // écoute la soumission du formulaire (submit)
    ui.searchForm?.addEventListener("submit", (e) => {
      e.preventDefault(); // empêche le rechargement automatique de la page
      const val = ui.pokemonInput.value.trim(); // lit et nettoie la valeur entrée
      if (val) executeSearch(val); // lance la recherche si non vide
    });

    // quand les filtres changent, relance la recherche du pokémon courant
    [ui.rarityFilter, ui.aspectFilter].forEach((f) => {
      f?.addEventListener("change", () => {
        if (currentPokemon) executeSearch(currentPokemon);
      });
    });

    // bouton pour effacer l'historique et les stats locales
    if (ui.clearHistoryBtn) {
      ui.clearHistoryBtn.onclick = () => {
        localStorage.removeItem(HISTORY_KEY); // supprime l'historique
        localStorage.removeItem(STATS_KEY); // supprime les stats
        renderHistory(); // met à jour l'affichage
        renderTopFive(); // met à jour le top
      };
    }
  }

  // --- LOGIQUE CORE --- (récupération données, affichage, etc.)

  // exécute une recherche et affiche le résultat
  async function executeSearch(query) {
    toggleLoading(true); // montre l'état chargement
    try {
      const statsData = await fetch(
        `${API_POKEBUILD}${encodeURIComponent(query)}?t=${Date.now()}`,
      ).then((res) => {
        if (!res.ok) throw new Error("Pokémon introuvable."); // si réponse non OK
        return res.json(); // convertit la réponse en JSON
      });

      currentPokemon = statsData.name; // met à jour le nom courant
      // normalise les valeurs des filtres en minuscules pour comparaisons fiables
      const rFilter = (ui.rarityFilter?.value || "all").toLowerCase(); // lit le filtre rareté
      const aFilter = (ui.aspectFilter?.value || "standard").toLowerCase(); // lit le filtre aspect

      const tcgCard = await fetchBestTcgCard(currentPokemon, rFilter, aFilter); // cherche une carte TCG adaptée
      createFinalCard(statsData, tcgCard); // construit la carte affichée
      updateHistoryAndStats(statsData); // met à jour historique et stats

      // rafraîchit les suggestions aléatoires à chaque recherche réussie
      loadRandomSuggestions();

      ui.pokemonInput.value = ""; // vide le champ de recherche
      hideError(); // cache un éventuel message d'erreur
    } catch (error) {
      showError(error.message); // affiche l'erreur à l'utilisateur
    } finally {
      toggleLoading(false); // désactive l'état chargement
    }
  }

  // récupère une liste de cartes TCG et choisit la meilleure selon un score
  async function fetchBestTcgCard(name, rFilter, aFilter) {
    try {
      const list = await fetch(
        `${API_TCGDEX}/cards?name=${encodeURIComponent(name)}`,
      ).then((res) => res.json()); // requête légère
      if (!Array.isArray(list) || list.length === 0) return null; // pas de résultat

      const sliceSize = Math.min(list.length, MAX_CANDIDATES); // limite le nombre inspecté
      const candidates = await Promise.all(
        list
          .slice(-sliceSize) // prend les cartes les plus récentes
          .map(
            (c) =>
              fetch(`${API_TCGDEX}/cards/${c.id}`).then((res) => res.json()), // récupère les détails
          ),
      );

      return candidates.sort(
        (a, b) =>
          scoreCard(b, name, rFilter, aFilter) -
          scoreCard(a, name, rFilter, aFilter),
      )[0]; // renvoie la carte avec le meilleur score
    } catch (e) {
      return null; // en cas d'erreur réseau
    }
  }

  // calcule un score pour une carte (plus le score est élevé, mieux c'est)
  function scoreCard(card, query, rFilter, aFilter) {
    let score = 0; // valeur initiale
    const name = (card.name || "").toLowerCase(); // nom en minuscules
    const rarity = (card.rarity || "").toLowerCase(); // rareté en minuscules
    const stage = (card.stage || "").toLowerCase(); // stage en minuscules
    const subtype = (card.subtype || "").toLowerCase(); // sous-type (ex: VMAX, V)
    const supertype = (card.supertype || "").toLowerCase(); // supertype si présent
    const search = query.toLowerCase(); // terme recherché en minuscules

    if (name === search)
      score += 10000; // correspondance exacte -> gros bonus
    else if (name.includes(search)) score += 5000; // contient le terme -> bonus

    if (rFilter !== "all") {
      // étend la correspondance aux champs subtype/supertype pour couvrir VMAX/VSTAR etc.
      const isMatch =
        name.includes(rFilter) ||
        stage.includes(rFilter) ||
        rarity.includes(rFilter) ||
        subtype.includes(rFilter) ||
        supertype.includes(rFilter); // correspondance approximative étendue
      if (isMatch) score += 20000; // grosse priorité si correspond

      const specials = ["vmax", "vstar", "ex", "gx", "v", "mega"];
      if (
        rFilter === "basic" &&
        specials.some(
          (s) =>
            name.includes(s) || subtype.includes(s) || supertype.includes(s),
        )
      )
        score -= 15000; // pénalise fortement les versions spéciales si on veut basic
    }

    if (aFilter !== "standard") {
      const isShiny = rarity.includes("shiny") || name.includes("shiny");
      const isSecret = rarity.includes("secret") || rarity.includes("rainbow");
      if (aFilter === "shiny" && isShiny) score += 15000; // bonus shiny
      if (aFilter === "secret" && isSecret) score += 15000; // bonus secret
    }

    if (card.image) score += 1000; // bonus si la carte a une image
    score += parseInt(card.hp) || 0; // ajoute les HP si disponibles

    return score; // renvoie le score calculé
  }

  // construit la carte affichée en clonant le template HTML
  function createFinalCard(pokemon, tcg) {
    if (!ui.cardTemplate) return; // si pas de template, on quitte
    // mémorise les valeurs actuellement sélectionnées (si présentes)
    const prevRarity = ui.rarityFilter?.value ?? null;
    const prevAspect = ui.aspectFilter?.value ?? null;

    ui.cardsContainer.innerHTML = ""; // vide le conteneur avant d'ajouter
    const clone = ui.cardTemplate.content.cloneNode(true); // clone profond du template
    const cardEl = clone.querySelector(".card"); // élément principal de la carte
    const mainImg = clone.querySelector('[data-field="image"]'); // image principale
    const tcgImg = clone.querySelector('[data-field="carte"]'); // image TCG

    mainImg.crossOrigin = "anonymous"; // autorise lecture des pixels (ColorThief)
    mainImg.src = `${pokemon.image}?c=${Date.now()}`; // ajoute timestamp pour forcer reload
    tcgImg.src = tcg && tcg.image ? `${tcg.image}/high.webp` : pokemon.image; // fallback

    clone.querySelector('[data-field="name"]').textContent =
      tcg?.name || pokemon.name; // nom : priorité au nom TCG si présent
    clone.querySelector('[data-field="id"]').textContent = `#${pokemon.id}`; // affiche l'id
    clone.querySelector('[data-field="generation"]').textContent =
      tcg?.rarity || `Gen ${pokemon.apiGeneration}`; // affiche la rareté ou la gen

    const s = pokemon.stats || {}; // stats Pokebuild ou objet vide
    const statsMap = {
      hp: tcg?.hp || s.HP,
      attack: s.attack,
      defense: s.defense,
      "special-attack": s.special_attack,
      "special-defense": s.special_defense,
      speed: s.speed,
    };
    Object.entries(statsMap).forEach(([k, v]) => {
      const el = clone.querySelector(`[data-stat="${k}"]`); // trouve l'élément correspondant
      if (el) el.textContent = v ?? "—"; // affiche la valeur ou '—' si manquante
    });

    ui.cardsContainer.appendChild(clone); // ajoute la carte au DOM

    // --- RATTACHEMENT DES SELECTS SI ILS ONT ÉTÉ DÉPLACÉS DANS LE TEMPLATE ---
    // Certains sélecteurs (ex: choix-variantes) peuvent se trouver à l'intérieur
    // du template cloné. Si c'est le cas, on les récupère ici et on les rattache
    // à l'objet `ui`, puis on ajoute un écouteur pour relancer la recherche
    // lorsque l'utilisateur change de version/aspect.
    try {
      // Cherche les selects par id dans la carte (si l'auteur les a laissés avec ces id)
      const localRarity = ui.cardsContainer.querySelector("#rarity-filter");
      const localAspect = ui.cardsContainer.querySelector("#aspect-filter");

      // helper : applique une valeur à un select en ignorant la casse des options
      const applySelectValueIgnoreCase = (select, val) => {
        if (!select || val == null) return;
        const opt = Array.from(select.options).find(
          (o) => o.value.toLowerCase() === String(val).toLowerCase(),
        );
        if (opt) select.value = opt.value;
      };

      // si on trouve un select dans le clone, on lui applique la valeur précédemment choisie
      if (localRarity) {
        applySelectValueIgnoreCase(localRarity, prevRarity);
        // si aucune valeur précédente, privilégie l'option 'basic' comme valeur par défaut
        if (prevRarity == null) {
          const basicOpt = Array.from(localRarity.options).find(
            (o) => o.value.toLowerCase() === "basic",
          );
          if (basicOpt) localRarity.value = basicOpt.value;
        }
        ui.rarityFilter = localRarity; // remplace la référence globale par l'élément actuel
        // attache le listener après avoir appliqué la valeur pour éviter déclenchements involontaires
        localRarity.onchange = () => {
          if (currentPokemon) executeSearch(currentPokemon);
        };
      }

      if (localAspect) {
        applySelectValueIgnoreCase(localAspect, prevAspect);
        // si aucune valeur précédente, privilégie l'option 'standard' comme valeur par défaut
        if (prevAspect == null) {
          const stdOpt = Array.from(localAspect.options).find(
            (o) => o.value.toLowerCase() === "standard",
          );
          if (stdOpt) localAspect.value = stdOpt.value;
        }
        ui.aspectFilter = localAspect; // remplace la référence globale
        localAspect.onchange = () => {
          if (currentPokemon) executeSearch(currentPokemon);
        };
      }
    } catch (e) {
      // en cas d'erreur, on ignore pour ne pas casser l'affichage
    }

    applyDynamicColors(mainImg, cardEl); // applique des couleurs dynamiques à partir de l'image
  }

  // utilise ColorThief pour extraire la couleur dominante et l'appliquer
  function applyDynamicColors(img, card) {
    if (typeof ColorThief === "undefined") return; // si la lib n'est pas chargée, on sort
    const ct = new ColorThief(); // nouvelle instance
    const run = () => {
      try {
        const rgb = ct.getColor(img); // récupère [r,g,b]
        const col = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        document
          .querySelectorAll("h2")
          .forEach((h2) => h2.style.setProperty("color", col, "important")); // applique aux h2
        const n = card.querySelector('[data-field="name"]'); // nom dans la carte
        if (n) n.style.color = col; // applique la couleur
        img.style.filter = `drop-shadow(0 0 25px rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.5))`; // effet glow
      } catch (e) {
        // si erreur, on ignore pour ne pas casser l'UI
      }
    };
    if (img.complete)
      run(); // si l'image est déjà chargée
    else img.onload = run; // sinon attend l'événement load
  }

  // gère le comportement du header lors du scroll
  function handleHeaderScroll() {
    const s = window.scrollY > 50; // true si on a scrollé de plus de 50px
    document.querySelector("header")?.classList.toggle("header-scrolled", s); // toggle classe header
    ui.historyContainer?.classList.toggle("is-hidden", s); // cache l'historique si scroll
  }

  // met à jour l'historique (liste) et les stats (compteurs) dans localStorage
  function updateHistoryAndStats(p) {
    let h = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); // lit l'historique
    h = [p.name, ...h.filter((n) => n !== p.name)].slice(0, 7); // place en tête et enlève doublons
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); // sauvegarde
    renderHistory(); // met à jour l'affichage

    let st = JSON.parse(localStorage.getItem(STATS_KEY) || "{}"); // lit les stats
    if (!st[p.name]) st[p.name] = { count: 0, img: p.image }; // initialise si besoin
    st[p.name].count++; // incrémente le compteur
    localStorage.setItem(STATS_KEY, JSON.stringify(st)); // sauvegarde
    renderTopFive(); // met à jour le top 5
  }

  // affiche l'historique sous forme de boutons cliquables
  function renderHistory() {
    if (!ui.historyContainer) return; // si pas présent, rien à faire
    ui.historyContainer.innerHTML = ""; // vide le conteneur
    JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]").forEach((n) => {
      const b = document.createElement("button"); // crée un bouton par entrée
      b.className = "history-badge"; // classe CSS
      b.textContent = n; // texte = nom
      b.onclick = () => executeSearch(n); // clique relance la recherche
      ui.historyContainer.appendChild(b); // ajoute au DOM
    });
  }

  // affiche les 5 pokémon les plus vus
  function renderTopFive() {
    if (!ui.topContainer) return; // si pas présent, on sort
    ui.topContainer.innerHTML = ""; // vide
    const st = JSON.parse(localStorage.getItem(STATS_KEY) || "{}"); // lit les stats
    Object.entries(st)
      .sort((a, b) => b[1].count - a[1].count) // trie par count décroissant
      .slice(0, 5) // garde top 5
      .forEach(([n, d]) => {
        const i = document.createElement("img"); // crée une image miniature
        i.src = d.img; // source = image stockée
        i.className = "top-pkmn-thumb"; // classe CSS
        i.title = n; // tooltip
        i.onclick = () => {
          executeSearch(n); // lance la recherche au clic
          window.scrollTo({ top: 0, behavior: "smooth" }); // remonte en haut
        };
        ui.topContainer.appendChild(i); // ajoute au DOM
      });
  }

  // charge des suggestions aléatoires (miniatures cliquables)
  async function loadRandomSuggestions() {
    if (!ui.randomContainer) return; // si pas de conteneur, on quitte
    try {
      const l = await fetch(
        `https://pokebuildapi.fr/api/v1/random/team?t=${Date.now()}`,
      ).then((res) => res.json()); // requête aléatoire
      ui.randomContainer.innerHTML = ""; // vide
      l.slice(0, 5).forEach((p) => {
        const i = document.createElement("img");
        i.src = p.image; // image miniature
        i.className = "random-pkmn-thumb";
        i.onclick = () => {
          executeSearch(p.name); // recherche pour le pokémon cliqué
          window.scrollTo({ top: 0, behavior: "smooth" }); // remonte en haut
        };
        ui.randomContainer.appendChild(i); // ajoute la miniature
      });
    } catch (e) {
      // ignore les erreurs pour ne pas interrompre l'UI
    }
  }

  // active/désactive l'état visuel de chargement (opacité, curseur)
  function toggleLoading(a) {
    if (ui.searchForm) {
      ui.searchForm.style.opacity = a ? "0.5" : "1"; // change opacité
      ui.searchForm.style.pointerEvents = a ? "none" : "all"; // bloque les interactions si chargement
    }
    document.body.style.cursor = a ? "wait" : "default"; // change le curseur
  }

  // affiche un message d'erreur dans l'UI
  function showError(m) {
    if (ui.errorMessage) {
      ui.errorMessage.textContent = m; // place le texte
      ui.errorMessage.hidden = false; // rend visible
    }
  }
  // cache le message d'erreur
  function hideError() {
    if (ui.errorMessage) ui.errorMessage.hidden = true;
  }
})(); // fin de l'IIFE
