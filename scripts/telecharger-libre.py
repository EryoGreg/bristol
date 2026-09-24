#!/usr/bin/env python3
"""
Télécharge une image libre par structure vers data/anatomie/images/libre/<slug>.<ext>.

Sources : images de l'article Wikipédia FR + membres de la catégorie Wikimedia
Commons. Chaque candidat est noté (format SVG > GIF > PNG > JPEG, indices
« légendé », largeur, terme français) ; les images comparées/animales et les
icônes sont rejetées. Seules les licences diffusables sont acceptées
(domaine public, CC0, CC-BY, CC-BY-SA).

SVG et GIF sont gardés tels quels (vectoriel net / animation) ; le reste est
converti en JPEG ≤ 1500 px / ≤ 450 Ko.

Attributions -> data/anatomie/credits-libre.json

  python scripts/telecharger-libre.py [slug ...]
"""
import sys, os, json, io, re, time, urllib.parse, urllib.request, urllib.error

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECK = os.path.join(RACINE, "data", "anatomie")
LIBRE = os.path.join(DECK, "images", "libre")
CREDITS = os.path.join(DECK, "credits-libre.json")
UA = "BristolAnatomyDeck/0.2 (educational flashcard deck; gregoire.pessiot17@gmail.com)"
PAUSE = 1.5

# slug -> (article Wikipédia FR, catégorie Wikimedia Commons)
LOT = {
    "os_frontal": ("Os frontal", "Human frontal bone"),
    "os_parietal": ("Os pariétal", "Human parietal bone"),
    "os_occipital": ("Os occipital", "Human occipital bone"),
    "os_temporal": ("Os temporal", "Human temporal bone"),
    "os_sphenoide": ("Os sphénoïde", "Human sphenoid bone"),
    "os_ethmoide": ("Os ethmoïde", "Human ethmoid bone"),
    "maxillaire": ("Maxillaire (os)", "Human maxilla"),
    "mandibule": ("Mandibule", "Human mandible"),
    "os_zygomatique": ("Os zygomatique", "Human zygomatic bone"),
    "os_nasal": ("Os nasal", "Human nasal bone"),
    "os_palatin": ("Os palatin", "Human palatine bone"),
    "vomer": ("Vomer", "Human vomer"),
    "cornet_nasal_inferieur": ("Cornet nasal inférieur", "Human inferior nasal concha"),
    "crane_vue_anterieure": ("Crâne", "Anterior view of human skull"),
    "crane_vue_laterale": ("Crâne", "Lateral view of human skull"),
    "base_crane_inferieure": ("Base du crâne", "Inferior view of human skull"),
    "base_crane_endocranienne": ("Base du crâne", "Interior of human skull base"),
    "calvaria": ("Calvaria (anatomie)", "Cranial sutures"),
    "fontanelle": ("Fontanelle", "Fontanelle"),
    "processus_pterygoide": ("Processus ptérygoïde", "Pterygoid process"),
    "foramen_magnum": ("Foramen magnum", "Foramen magnum"),
    "canal_optique": ("Canal optique", "Optic canal"),
    "fissure_orbitaire_superieure": ("Fissure orbitaire supérieure", "Superior orbital fissure"),
    "foramen_rond": ("Foramen rond", "Foramen rotundum"),
    "foramen_ovale": ("Foramen ovale (crâne)", "Foramen ovale (skull)"),
    "foramen_epineux": ("Foramen épineux", "Foramen spinosum"),
    "foramen_dechire": ("Foramen déchiré", "Foramen lacerum"),
    "foramen_jugulaire": ("Foramen jugulaire", "Jugular foramen"),
    "canal_carotidien": ("Canal carotidien", "Carotid canal"),
    "canal_hypoglosse": ("Canal du nerf hypoglosse", "Hypoglossal canal"),
    "meat_acoustique_interne": ("Méat acoustique interne", "Internal acoustic meatus"),
    "lame_criblee": ("Lame criblée", "Cribriform plate"),
    "atlas": ("Atlas (anatomie)", "Atlas (anatomy)"),
    "axis": ("Axis (anatomie)", "Axis (anatomy)"),
    "vertebre_cervicale": ("Vertèbres cervicales", "Cervical vertebrae"),
    "articulation_uncovertebrale": ("Articulation uncovertébrale", "Uncovertebral joints"),
    "articulation_temporo_mandibulaire": ("Articulation temporo-mandibulaire", "Temporomandibular joint"),
    "ligament_nuchal": ("Ligament nuchal", "Nuchal ligament"),
    "membrane_atlanto_occipitale_anterieure": ("Membrane atlanto-occipitale antérieure", "Anterior atlanto-occipital membrane"),
    "membrane_atlanto_occipitale_posterieure": ("Membrane atlanto-occipitale postérieure", "Posterior atlanto-occipital membrane"),
    "ligament_transverse_atlas": ("Ligament transverse de l'atlas", "Transverse ligament of atlas"),
    "ligament_alaire": ("Ligament alaire", "Alar ligaments"),
    "membrane_tectoria": ("Membrane tectoria", "Tectorial membrane of atlanto-axial joint"),

    # --- lot 1a : face superficielle (mimique, mastication, parotide, fascias) ---
    "muscles_mimique": ("Muscles peauciers du visage", "Facial muscles"),
    "muscle_occipitofrontal": ("Muscle occipito-frontal", "Occipitofrontalis muscle"),
    "muscle_orbiculaire_oeil": ("Muscle orbiculaire de l'œil", "Orbicularis oculi muscle"),
    "muscle_orbiculaire_bouche": ("Muscle orbiculaire de la bouche", "Orbicularis oris muscle"),
    "muscle_buccinateur": ("Muscle buccinateur", "Buccinator muscle"),
    "platysma": ("Muscle platysma", "Platysma muscle"),
    "muscle_temporal": ("Muscle temporal", "Temporalis muscle"),
    "muscle_masseter": ("Muscle masséter", "Masseter muscle"),
    "muscle_pterygoidien_medial": ("Muscle ptérygoïdien médial", "Medial pterygoid muscle"),
    "muscle_pterygoidien_lateral": ("Muscle ptérygoïdien latéral", "Lateral pterygoid muscle"),
    "glande_parotide": ("Glande parotide", "Parotid gland"),
    "conduit_parotidien": ("Conduit parotidien", "Parotid duct"),
    "nerf_facial_extracranien": ("Nerf facial", "Facial nerve"),
    "fascia_cervical": ("Fascia cervical", "Cervical fascia"),
    "gaine_carotidienne": ("Gaine carotidienne", "Carotid sheath"),

    # --- lot 1b : cou musculaire ---
    "muscle_sterno_cleido_mastoidien": ("Muscle sterno-cléido-mastoïdien", "Sternocleidomastoid muscles"),
    "muscle_trapeze": ("Muscle trapèze", "Trapezius muscles"),
    "muscle_digastrique": ("Muscle digastrique", "Digastric muscle"),
    "muscle_mylo_hyoidien": ("Muscle mylo-hyoïdien", "Mylohyoid muscle"),
    "muscle_genio_hyoidien": ("Muscle génio-hyoïdien", "Geniohyoid muscle"),
    "muscle_stylo_hyoidien": ("Muscle stylo-hyoïdien", "Stylohyoid muscle"),
    "muscle_sterno_hyoidien": ("Muscle sterno-hyoïdien", "Sternohyoid muscle"),
    "muscle_sterno_thyroidien": ("Muscle sterno-thyroïdien", "Sternothyroid muscle"),
    "muscle_thyro_hyoidien": ("Muscle thyro-hyoïdien", "Thyrohyoid muscle"),
    "muscle_omo_hyoidien": ("Muscle omo-hyoïdien", "Omohyoid muscle"),
    "muscle_scalene_anterieur": ("Muscle scalène antérieur", "Anterior scalene muscle"),
    "muscle_scalene_moyen": ("Muscle scalène moyen", "Middle scalene muscle"),
    "muscle_scalene_posterieur": ("Muscle scalène postérieur", "Posterior scalene muscle"),
    "muscle_long_du_cou": ("Muscle long du cou", "Longus colli muscle"),
    "muscle_long_de_la_tete": ("Muscle long de la tête", "Longus capitis muscle"),
    "os_hyoide": ("Os hyoïde", "Hyoid bone"),
    "triangle_anterieur_cou": ("Triangle antérieur du cou", "Anterior triangle of the neck"),
    "triangle_posterieur_cou": ("Triangle postérieur du cou", "Posterior triangle of the neck"),

    # --- lot 1c : cou superficiel (veines, plexus cervical) ---
    "veine_jugulaire_externe": ("Veine jugulaire externe", "External jugular vein"),
    "veine_jugulaire_anterieure": ("Veine jugulaire antérieure", "Anterior jugular vein"),
    "plexus_cervical": ("Plexus cervical", "Cervical plexus"),
    "nerf_grand_auriculaire": ("Nerf grand auriculaire", "Great auricular nerve"),
    "nerf_petit_occipital": ("Nerf petit occipital", "Lesser occipital nerve"),
    "nerf_transverse_du_cou": ("Nerf transverse du cou", "Transverse cervical nerve"),
    "nerfs_supraclaviculaires": ("Nerfs supra-claviculaires", "Supraclavicular nerves"),
    "nerf_grand_occipital": ("Nerf grand occipital", "Greater occipital nerve"),
    "anse_cervicale": ("Anse cervicale", "Ansa cervicalis"),

    # --- lot 2 : nez et sinus ---
    "nez_externe": ("Nez", "Human nose"),
    "cavite_nasale": ("Fosses nasales", "Nasal cavity"),
    "paroi_laterale_nasale": ("Fosses nasales", "Lateral wall of nasal cavity"),
    "septum_nasal": ("Septum nasal", "Nasal septum"),
    "choanes": ("Choane", "Choanae"),
    "sinus_frontal": ("Sinus frontal", "Frontal sinus"),
    "sinus_maxillaire": ("Sinus maxillaire", "Maxillary sinus"),
    "cellules_ethmoidales": ("Sinus ethmoïdal", "Ethmoid sinus"),
    "sinus_sphenoidal": ("Sinus sphénoïdal", "Sphenoid sinus"),
    "tache_vasculaire": ("Tache vasculaire", "Kiesselbach's plexus"),
    "innervation_cavite_nasale": ("Nerfs de la cavité nasale", "Nerves of nasal cavity"),

    # --- lot 3 : bouche, langue, dents ---
    "cavite_buccale": ("Cavité buccale", "Mouth"),
    "palais_dur": ("Palais osseux", "Hard palate"),
    "voile_du_palais": ("Voile du palais", "Soft palate"),
    "muscle_tenseur_voile_palais": ("Muscle tenseur du voile du palais", "Tensor veli palatini muscle"),
    "muscle_elevateur_voile_palais": ("Muscle élévateur du voile du palais", "Levator veli palatini muscle"),
    "autres_muscles_voile": ("Muscle palato-glosse", "Palatoglossus muscle"),
    "langue": ("Langue", "Human tongue"),
    "muscle_genio_glosse": ("Muscle génio-glosse", "Genioglossus muscle"),
    "muscle_hyo_glosse": ("Muscle hyo-glosse", "Hyoglossus muscle"),
    "muscle_stylo_glosse": ("Muscle stylo-glosse", "Styloglossus muscle"),
    "papilles_linguales": ("Papille linguale", "Lingual papillae"),
    "glande_submandibulaire": ("Glande submandibulaire", "Submandibular gland"),
    "glande_sublinguale": ("Glande sublinguale", "Sublingual gland"),
    "dents": ("Dent", "Human teeth"),
    "tonsille_palatine": ("Amygdale palatine", "Palatine tonsil"),
    "nerf_lingual": ("Nerf lingual", "Lingual nerve"),

    # --- lot 4 : pharynx ---
    "pharynx": ("Pharynx", "Human pharynx"),
    "rhinopharynx": ("Rhinopharynx", "Nasopharynx"),
    "oropharynx": ("Oropharynx", "Oropharynx"),
    "laryngopharynx": ("Laryngopharynx", "Hypopharynx"),
    "muscle_constricteur_superieur": ("Muscle constricteur supérieur du pharynx", "Superior pharyngeal constrictor muscle"),
    "muscle_constricteur_moyen": ("Muscle constricteur moyen du pharynx", "Middle pharyngeal constrictor muscle"),
    "muscle_constricteur_inferieur": ("Muscle constricteur inférieur du pharynx", "Inferior pharyngeal constrictor muscle"),
    "muscles_elevateurs_pharynx": ("Muscle stylo-pharyngien", "Stylopharyngeus muscle"),
    "trompe_auditive": ("Trompe auditive", "Eustachian tube"),
    "tonsille_pharyngienne": ("Amygdale pharyngée", "Pharyngeal tonsil"),

    # --- lot 5 : larynx et thyroïde ---
    "larynx": ("Larynx", "Human larynx"),
    "cartilage_thyroide": ("Cartilage thyroïde", "Thyroid cartilage"),
    "cartilage_cricoide": ("Cartilage cricoïde", "Cricoid cartilage"),
    "cartilages_arytenoides": ("Cartilage aryténoïde", "Arytenoid cartilage"),
    "epiglotte": ("Épiglotte", "Epiglottis"),
    "membrane_thyrohyoidienne": ("Membrane thyro-hyoïdienne", "Thyrohyoid membrane"),
    "cone_elastique": ("Cône élastique", "Cricothyroid ligament"),
    "plis_vocaux": ("Pli vocal", "Vocal cords"),
    "muscle_cricothyroidien": ("Muscle crico-thyroïdien", "Cricothyroid muscle"),
    "muscle_cricoarytenoidien_posterieur": ("Muscle crico-aryténoïdien postérieur", "Posterior cricoarytenoid muscle"),
    "muscle_cricoarytenoidien_lateral": ("Muscle crico-aryténoïdien latéral", "Lateral cricoarytenoid muscle"),
    "muscle_thyroarytenoidien": ("Muscle thyro-aryténoïdien", "Thyroarytenoid muscle"),
    "muscle_arytenoidien": ("Muscle aryténoïdien", "Arytenoid muscle"),
    "nerf_larynge_superieur": ("Nerf laryngé supérieur", "Superior laryngeal nerve"),
    "nerf_larynge_recurrent": ("Nerf laryngé récurrent", "Recurrent laryngeal nerve"),
    "glande_thyroide": ("Glande thyroïde", "Thyroid"),
    "glandes_parathyroides": ("Glande parathyroïde", "Parathyroid gland"),

    # --- lot 6 : orbite et oeil ---
    "orbite_osseuse": ("Orbite", "Orbit (anatomy)"),
    "muscles_oculomoteurs": ("Muscles oculomoteurs", "Extraocular muscles"),
    "muscle_droit_lateral": ("Muscle droit latéral", "Lateral rectus muscle"),
    "muscle_oblique_superieur": ("Muscle oblique supérieur", "Superior oblique muscle"),
    "muscle_releveur_paupiere": ("Muscle releveur de la paupière supérieure", "Levator palpebrae superioris muscle"),
    "anneau_tendineux_zinn": ("Anneau tendineux commun", "Common tendinous ring"),
    "globe_oculaire": ("Œil", "Human eye"),
    "cornee": ("Cornée", "Cornea"),
    "cristallin": ("Cristallin", "Lens (anatomy)"),
    "retine": ("Rétine", "Retina"),
    "nerf_optique_ii": ("Nerf optique", "Optic nerve"),
    "appareil_lacrymal": ("Appareil lacrymal", "Lacrimal apparatus"),
    "paupieres": ("Paupière", "Eyelid"),
    "ganglion_ciliaire": ("Ganglion ciliaire", "Ciliary ganglion"),
    "artere_ophtalmique": ("Artère ophtalmique", "Ophthalmic artery"),

    # --- lot 7 : oreille ---
    "oreille_externe": ("Oreille externe", "Outer ear"),
    "membrane_tympanique": ("Tympan", "Eardrum"),
    "oreille_moyenne": ("Oreille moyenne", "Middle ear"),
    "osselets": ("Osselet", "Ossicles"),
    "muscles_oreille_moyenne": ("Muscle de l'étrier", "Stapedius muscle"),
    "oreille_interne": ("Oreille interne", "Inner ear"),
    "cochlee": ("Cochlée", "Cochlea"),
    "vestibule_labyrinthe": ("Vestibule (oreille interne)", "Vestibule of the ear"),
    "canaux_semi_circulaires": ("Canal semi-circulaire", "Semicircular canals"),
    "nerf_vestibulo_cochleaire": ("Nerf vestibulocochléaire", "Vestibulocochlear nerve"),
    "nerf_facial_intrapetreux": ("Nerf facial", "Facial canal"),

    # --- lot 8 : méninges ---
    "dure_mere_cranienne": ("Dure-mère", "Dura mater"),
    "faux_du_cerveau": ("Faux du cerveau", "Falx cerebri"),
    "tente_du_cervelet": ("Tente du cervelet", "Tentorium cerebelli"),
    "arachnoide": ("Arachnoïde", "Arachnoid mater"),
    "pie_mere": ("Pie-mère", "Pia mater"),
    "sinus_sagittal_superieur": ("Sinus sagittal supérieur", "Superior sagittal sinus"),
    "sinus_lateraux_duraux": ("Sinus transverse", "Transverse sinuses"),
    "sinus_caverneux": ("Sinus caverneux", "Cavernous sinus"),
    "circulation_lcs": ("Liquide cérébro-spinal", "Cerebrospinal fluid"),
    "granulations_arachnoidiennes": ("Granulation arachnoïdienne", "Arachnoid granulation"),

    # --- lot 9 : nerfs crâniens ---
    "nc_vue_ensemble": ("Nerf crânien", "Cranial nerves"),
    "nerf_olfactif_i": ("Nerf olfactif", "Olfactory nerve"),
    "nerf_oculomoteur_iii": ("Nerf oculomoteur", "Oculomotor nerve"),
    "nerf_trochleaire_iv": ("Nerf trochléaire", "Trochlear nerve"),
    "nerf_trijumeau_v": ("Nerf trijumeau", "Trigeminal nerve"),
    "nerf_ophtalmique_v1": ("Nerf ophtalmique", "Ophthalmic nerve"),
    "nerf_maxillaire_v2": ("Nerf maxillaire", "Maxillary nerve"),
    "nerf_mandibulaire_v3": ("Nerf mandibulaire", "Mandibular nerve"),
    "nerf_abducens_vi": ("Nerf abducens", "Abducens nerve"),
    "nerf_glossopharyngien_ix": ("Nerf glosso-pharyngien", "Glossopharyngeal nerve"),
    "nerf_vague_x": ("Nerf vague", "Vagus nerve"),
    "nerf_accessoire_xi": ("Nerf accessoire", "Accessory nerve"),
    "nerf_hypoglosse_xii": ("Nerf hypoglosse", "Hypoglossal nerve"),

    # --- lot 10 : vascularisation ---
    "artere_carotide_commune": ("Artère carotide commune", "Common carotid artery"),
    "artere_carotide_externe": ("Artère carotide externe", "External carotid artery"),
    "artere_thyroidienne_superieure": ("Artère thyroïdienne supérieure", "Superior thyroid artery"),
    "artere_linguale": ("Artère linguale", "Lingual artery"),
    "artere_faciale": ("Artère faciale", "Facial artery"),
    "artere_occipitale": ("Artère occipitale", "Occipital artery"),
    "artere_temporale_superficielle": ("Artère temporale superficielle", "Superficial temporal artery"),
    "artere_maxillaire": ("Artère maxillaire", "Maxillary artery"),
    "artere_meningee_moyenne": ("Artère méningée moyenne", "Middle meningeal artery"),
    "artere_carotide_interne": ("Artère carotide interne", "Internal carotid artery"),
    "artere_vertebrale": ("Artère vertébrale", "Vertebral artery"),
    "cercle_arteriel_willis": ("Polygone de Willis", "Circle of Willis"),
    "veine_jugulaire_interne": ("Veine jugulaire interne", "Internal jugular vein"),
    "veine_faciale": ("Veine faciale", "Facial vein"),
    "plexus_pterygoidien": ("Plexus ptérygoïdien", "Pterygoid plexus"),
    "drainage_lymphatique_cou": ("Ganglion lymphatique cervical", "Lymph nodes of the head and neck"),
}

LIC_OK = ("public domain", "pd-", "cc0", "cc-zero", "cc-by", "cc by")
GIF_MAX = 4 * 1024 * 1024        # au-dela : on reduit le GIF frame par frame (cote <= 500 px)
GIF_CIBLE_PX = 500
JUNK_MOTS = ("blue pencil", "info simple", "star of life", "creative-tail", "commons-logo",
             "wiktionary", "edit-icon", "symbole-faune", "entomology icon", "wp-orange-source",
             "translation to english", "disambig", "logo", " icon", "icon ", "flag of", "map of",
             "nuvola", "crystal clear", "ambox", "gnome-", "text document", "lock-", "padlock",
             "-lock", "wikidata", "question book", "red pog", "green pog")
REJET = ("boar", "sanglier", "foina", "martes", "marten", "aardwolf", "protele", " dog", " cat",
         " pig", "sheep", " rat", " mouse", "primate", " ape", "gorilla", "bovine", "canine",
         "feline", "equine", "comparative", "veterinaire", "veterinary", "bullant", "insecte",
         "aurochs", " cow", "cattle", "neolithic", " bce", " bc ", "museum", "archaeolog",
         "fossil", "specimen", "zoo ", "dinosaur", "reptile", "bird ", "fish ", "whale",
         "spinobones", "backbone vertebra")
EXT_RASTER = ("png", "jpg", "jpeg", "tif", "tiff", "webp")

# choix manuels : Commons File name imposé (Gray's Anatomy 1918 = domaine public,
# vérifié). Le composite « Skull foramina labeled.svg » (CC-BY-SA) légende
# magnum / jugulaire / épineux / ovale / rond / F.O. supérieure / canal optique.
FORAMENS_SVG = "Skull foramina labeled.svg"
OVERRIDE = {
    "os_frontal": "Gray134.png",
    "os_parietal": "Gray 132 - Os Pariétal Gauche - Surface-externe.png",
    "os_occipital": "Gray129.png",
    "os_temporal": "Gray137.png",
    "os_sphenoide": "Gray147.png",
    "os_ethmoide": "Gray149.png",
    "maxillaire": "Gray157.png",
    "mandibule": "Gray176.png",
    "os_zygomatique": "Gray164.png",
    "os_nasal": "Nasal bone.png",
    "os_palatin": "Palatine bone.png",
    "vomer": "Sobo 1909 73.png",
    "cornet_nasal_inferieur": "Gray170.png",
    "crane_vue_anterieure": "Gray190.png",
    "crane_vue_laterale": "Gray188.png",
    "base_crane_inferieure": "Crane4.png",
    "base_crane_endocranienne": "Gray193.png",
    "calvaria": "Gray188.png",
    "fontanelle": "Fontanelle.png",
    "processus_pterygoide": "Gray147.png",
    "lame_criblee": "Gray149.png",
    "canal_carotidien": "Gray141.png",
    "canal_hypoglosse": "Base of skull 19.jpg",
    "meat_acoustique_interne": "Sobo 1909 781.png",
    "foramen_dechire": "Base of skull 16.jpg",
    "atlas": "Gray86.png",
    "axis": "Gray87.png",
    "vertebre_cervicale": "Gray84.png",
    "articulation_temporo_mandibulaire": "Gray309-en.svg",
    "ligament_nuchal": "Nuchal ligament.PNG",
    "membrane_atlanto_occipitale_anterieure": "Gray304.png",
    "membrane_atlanto_occipitale_posterieure": "Gray305.png",
    "ligament_transverse_atlas": "Gray307.png",
    "ligament_alaire": "Gray307.png",
    "membrane_tectoria": "Gray307.png",
    "foramen_magnum": FORAMENS_SVG,
    "foramen_ovale": FORAMENS_SVG,
    "foramen_rond": FORAMENS_SVG,
    "foramen_epineux": FORAMENS_SVG,
    "foramen_jugulaire": FORAMENS_SVG,
    "canal_optique": FORAMENS_SVG,
    "fissure_orbitaire_superieure": FORAMENS_SVG,

    # --- lot 1b : cou musculaire (série « Gray — musculus X.png » = surbrillance) ---
    "muscle_sterno_cleido_mastoidien": "Gray — musculus sternocleidomastoideus.png",
    "muscle_trapeze": "Gray385.png",
    "muscle_mylo_hyoidien": "Gray — musculus mylohyoideus.png",
    "muscle_genio_hyoidien": "Gray — musculus geniohyoideus.png",
    "muscle_stylo_hyoidien": "Gray — musculus stylohyoideus.png",
    "muscle_sterno_hyoidien": "Gray — musculus sternohyoideus.png",
    "muscle_sterno_thyroidien": "Gray — musculus sternothyroideus.png",
    "muscle_thyro_hyoidien": "Gray — musculus thyrohyoideus.png",
    "muscle_scalene_anterieur": "Gray — musculus scalenus anterior.png",
    "muscle_scalene_moyen": "Gray — musculus scalenus medius.png",
    "muscle_scalene_posterieur": "Gray — musculus scalenus posterior.png",
    "muscle_long_du_cou": "Gray — musculus longus colli.png",
    "muscle_long_de_la_tete": "Gray — musculus longus capitis.png",
    "os_hyoide": "Hyoid bone.png",
    "triangle_posterieur_cou": "Gray385.png",

    # --- lot 1c ---
    "plexus_cervical": "Gray804.png",
    "nerf_grand_auriculaire": "Gray1210.png",
    "nerf_petit_occipital": "Gray1210.png",
    "nerf_transverse_du_cou": "Gray1210.png",
    "nerfs_supraclaviculaires": "Gray1210.png",
    "nerf_grand_occipital": "Gray801.png",
    "anse_cervicale": "Gray804.png",

    # --- lot 2 : nez et sinus ---
    "nez_externe": "Gray852.png",
    "paroi_laterale_nasale": "Gray855.png",
    "tache_vasculaire": "Gray858.png",
    "innervation_cavite_nasale": "Gray858.png",

    # --- lot 3 : bouche, langue, dents ---
    "cavite_buccale": "Gray994.png",
    "voile_du_palais": "Gray1028.png",
    "muscle_tenseur_voile_palais": "Gray1028.png",
    "muscle_elevateur_voile_palais": "Gray1028.png",
    "autres_muscles_voile": "Gray1028.png",
    "langue": "Gray1019.png",
    "muscle_genio_glosse": "Gray1019.png",
    "muscle_hyo_glosse": "Gray1019.png",
    "muscle_stylo_glosse": "Gray1019.png",
    "papilles_linguales": "Gray1013.png",
    "glande_submandibulaire": "Gray1024.png",
    "glande_sublinguale": "Gray1024.png",
    "dents": "Human tooth diagram-en.svg",
    "tonsille_palatine": "Gray1013.png",
    "nerf_lingual": "Gray778.png",

    # --- lot 4 : pharynx ---
    "pharynx": "Pharynx diagram-fr.svg",
    "rhinopharynx": "Pharynx diagram-fr.svg",
    "oropharynx": "Pharynx diagram-fr.svg",
    "laryngopharynx": "Pharynx diagram-fr.svg",
    "muscle_constricteur_superieur": "Gray1030.png",
    "muscle_constricteur_moyen": "Gray1030.png",
    "muscle_constricteur_inferieur": "Gray1030.png",
    "tonsille_pharyngienne": "Gray1029.png",

    # --- lot 5 : larynx et thyroïde ---
    "muscle_thyroarytenoidien": "Gray960.png",
    "muscle_arytenoidien": "Gray960.png",
    "nerf_larynge_superieur": "Gray793.png",
    "nerf_larynge_recurrent": "Gray793.png",

    # --- lot 6 : orbite et oeil ---
    "orbite_osseuse": "Gray190.png",
    "muscles_oculomoteurs": "Gray776.png",
    "muscle_droit_lateral": "Gray776.png",
    "muscle_oblique_superieur": "Gray776.png",
    "muscle_releveur_paupiere": "Gray776.png",
    "anneau_tendineux_zinn": "Gray776.png",
    "globe_oculaire": "Gray869.png",
    "cornee": "Gray871.png",
    "retine": "Gray881.png",
    "nerf_optique_ii": "Gray776.png",
    "paupieres": "Gray893.png",

    # --- lot 7 : oreille ---
    "osselets": "Gray919.png",
    "vestibule_labyrinthe": "Gray920.png",
    "canaux_semi_circulaires": "Gray920.png",

    # --- lot 8 : méninges ---
    "dure_mere_cranienne": "Gray769-en.svg",
    "tente_du_cervelet": "Gray769-en.svg",
    "sinus_lateraux_duraux": "Gray769-en.svg",

    # --- lot 9 : nerfs crâniens ---
    "nerf_oculomoteur_iii": "Gray777.png",
    "nerf_trochleaire_iv": "Gray777.png",
    "nerf_ophtalmique_v1": "Gray777.png",
    "nerf_maxillaire_v2": "Gray778.png",
    "nerf_mandibulaire_v3": "Gray781.png",

    # --- lot 10 : vascularisation ---
    "artere_faciale": "Gray508.png",
    "plexus_pterygoidien": "Gray511.svg",
    "drainage_lymphatique_cou": "Gray602.png",

    # --- lot 1a (vérifié via Commons imageinfo) ---
    "muscles_mimique": "Gray378.png",
    "muscle_occipitofrontal": "Muscle occipito-frontal.png",
    "muscle_orbiculaire_oeil": "Gray379.png",
    "muscle_orbiculaire_bouche": "Gray378.png",
    "muscle_buccinateur": "Gray380.png",
    "platysma": "Gray AnatomyOfHumanBody1918-P644 Figure557.jpg",
    "muscle_temporal": "Muscle temporal droit.png",
    "muscle_masseter": "Gray378 (masseter highlight).png|Masseter muscle animation small.gif",
    "muscle_pterygoidien_medial": "Muscle pterygoidien lateral.png|Medial pterygoid muscle animation small.gif",
    "muscle_pterygoidien_lateral": "Muscle pterygoidien lateral.png",
    "glande_parotide": "Gray1024.png",
    "conduit_parotidien": "Gray1024.png",
    "nerf_facial_extracranien": "Cranial nerve VII.svg",
    "fascia_cervical": "Gray384.png",
    "gaine_carotidienne": "Gray384.png",
}


def _open(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    for essai in range(5):
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                time.sleep(6 * (essai + 1)); continue
            raise
    raise RuntimeError("HTTP répété")


def jget(url):
    return json.load(_open(url))


def api(host, **params):
    params.setdefault("format", "json")
    params.setdefault("action", "query")
    return jget(f"https://{host}/w/api.php?" + urllib.parse.urlencode(params))


def candidats(titre, categorie):
    noms = []
    try:
        p = list(api("fr.wikipedia.org", redirects=1, titles=titre,
                     prop="images", imlimit=60)["query"]["pages"].values())[0]
        noms += [i["title"].split(":", 1)[-1] for i in p.get("images", [])]
    except Exception:
        pass
    try:
        cm = api("commons.wikimedia.org", list="categorymembers",
                 cmtitle="Category:" + categorie, cmtype="file", cmlimit=40)
        noms += [m["title"].split(":", 1)[-1] for m in cm["query"].get("categorymembers", [])]
    except Exception:
        pass
    # repli : recherche Commons si la catégorie est maigre
    if len(noms) < 4:
        try:
            sr = api("commons.wikimedia.org", list="search", srnamespace=6,
                     srsearch=titre + " anatomy", srlimit=15)
            noms += [m["title"].split(":", 1)[-1] for m in sr["query"].get("search", [])]
        except Exception:
            pass
    vus, out = set(), []
    for n in noms:
        k = n.lower()
        if k in vus:
            continue
        vus.add(k)
        if any(j in k for j in JUNK_MOTS) or any(a in " " + k for a in REJET):
            continue
        if k.rsplit(".", 1)[-1] not in ("svg", "gif") + EXT_RASTER:
            continue
        out.append(n)
    return out


def infos(nom):
    p = list(api("commons.wikimedia.org", titles="File:" + nom,
                 prop="imageinfo", iiprop="url|size|mime|extmetadata")["query"]["pages"].values())[0]
    ii = (p.get("imageinfo") or [None])[0]
    if not ii:
        return None
    em = ii["extmetadata"]
    lic = (em.get("LicenseShortName", {}).get("value", "") or em.get("License", {}).get("value", "")).strip()
    auteur = re.sub(r"<[^>]+>", " ", em.get("Artist", {}).get("value", ""))
    auteur = re.sub(r"\s*\(\s*talk\s*\)\s*", " ", auteur)
    auteur = re.sub(r"\bderivative work\b", "— retouche :", auteur)
    auteur = re.sub(r"\s+", " ", auteur).strip(" :—")
    return {"url": ii["url"].split("?")[0], "licence": lic, "mime": ii.get("mime", ""),
            "w": ii.get("width", 0), "h": ii.get("height", 0), "taille": ii.get("size", 0),
            "auteur": re.sub(r"\s+", " ", auteur) or "voir source",
            "page": "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(nom.replace(" ", "_"))}


def score(nom, info, terme_fr):
    k = nom.lower()
    ext = k.rsplit(".", 1)[-1]
    if not any(x in info["licence"].lower() for x in LIC_OK):
        return -1e9
    if max(info["w"], info["h"]) and max(info["w"], info["h"]) < 120:
        return -1e9
    if ext == "gif" and info.get("taille", 0) > 40 * 1024 * 1024:
        return -1e9        # garde-fou : GIF absurdement lourd
    s = {"svg": 6, "gif": 2}.get(ext, 0)
    if "png" in info["mime"]:
        s += 2
    elif "jpeg" in info["mime"]:
        s += 1
    for h, pts in (("gray", 3), ("sobo", 3), ("anatomog", 2), ("bone", 1), ("- animation", 2),
                   ("label", 3), ("legend", 3), ("annot", 2), ("numbered", 2), ("-en", 1), ("-fr", 2),
                   ("humain", 2), ("human", 1)):
        if h in k:
            s += pts
    for mot in re.findall(r"[a-zàâäéèêëïîôöùûüç]{4,}", terme_fr.lower()):
        if mot in k:
            s += 1
    if max(info["w"], info["h"]):
        s += min(max(info["w"], info["h"]) // 500, 3)
    return s


def redim_jpeg(data):
    from PIL import Image
    im = Image.open(io.BytesIO(data)).convert("RGB")
    if max(im.size) > 1500:
        r = 1500 / max(im.size)
        im = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
    q = 88
    while q >= 55:
        b = io.BytesIO(); im.save(b, "JPEG", quality=q)
        if b.tell() <= 450 * 1024:
            return b.getvalue()
        q -= 6
    return b.getvalue()


def redim_gif(data):
    """GIF > GIF_MAX -> reduit chaque frame a GIF_CIBLE_PX de cote, garde l'anim."""
    if len(data) <= GIF_MAX:
        return data
    from PIL import Image, ImageSequence
    im = Image.open(io.BytesIO(data))
    if max(im.size) <= GIF_CIBLE_PX:
        return data
    r = GIF_CIBLE_PX / max(im.size)
    taille = (round(im.width * r), round(im.height * r))
    frames = [f.copy().resize(taille, Image.LANCZOS) for f in ImageSequence.Iterator(im)]
    b = io.BytesIO()
    frames[0].save(b, "GIF", save_all=True, append_images=frames[1:], loop=0,
                   duration=im.info.get("duration", 80), disposal=2, optimize=True)
    return b.getvalue() if b.tell() < len(data) else data


def legende_auto(nom, ext):
    k = nom.lower()
    if ext == "gif" or "animation" in k or "rotat" in k:
        return "Rotation 3D"
    if "label" in k or "legend" in k or "numbered" in k or "annot" in k:
        return "Vue légendée"
    return ""


def main():
    os.makedirs(LIBRE, exist_ok=True)
    credits = json.load(open(CREDITS, encoding="utf-8")) if os.path.exists(CREDITS) else {}
    for f in os.listdir(LIBRE):
        pass
    cibles = sys.argv[1:] or list(LOT)
    ok = ko = 0
    for slug in cibles:
        if slug not in LOT:
            print(f"  [? ]  {slug}: hors lot"); continue
        titre, cat = LOT[slug]
        try:
            # OVERRIDE[slug] : 1 nom Commons, ou liste « a.svg|b.gif » (galerie).
            if slug in OVERRIDE:
                choix = [(99, n.strip()) for n in OVERRIDE[slug].split("|") if n.strip()]
            else:
                noms = candidats(titre, cat)
                notes = []
                for n in noms[:22]:
                    d = infos(n)
                    if d:
                        notes.append((score(n, d, titre), n))
                    time.sleep(0.4)
                notes = [x for x in notes if x[0] > -1e8]
                if not notes:
                    print(f"  [--]  {slug}: aucun candidat libre ({cat})"); ko += 1; time.sleep(PAUSE); continue
                choix = [max(notes, key=lambda x: x[0])]

            # purge des anciens fichiers du slug (slug.ext ET slug-2.ext …)
            for old in list(credits):
                if old == slug or old.startswith(slug + ".") or old.startswith(slug + "-"):
                    try: os.remove(os.path.join(LIBRE, old))
                    except OSError: pass
                    credits.pop(old, None)

            produits = []
            for rang, (sc, nom) in enumerate(choix, 1):
                inf = infos(nom)
                if not inf or not any(x in inf["licence"].lower() for x in LIC_OK):
                    print(f"  [--]  {slug}: « {nom} » indisponible/licence KO"); continue
                ext = nom.lower().rsplit(".", 1)[-1]
                raw = _open(inf["url"], timeout=90).read()
                base = slug if rang == 1 else f"{slug}-{rang}"
                if ext == "svg":
                    fichier = base + ".svg"; blob = raw
                elif ext == "gif":
                    fichier = base + ".gif"; blob = redim_gif(raw)
                else:
                    fichier = base + ".jpg"; blob = redim_jpeg(raw)
                open(os.path.join(LIBRE, fichier), "wb").write(blob)
                credits[fichier] = {"structure": titre, "fichier_commons": nom,
                                    "licence": inf["licence"], "auteur": inf["auteur"],
                                    "source": inf["page"], "legende": legende_auto(nom, ext),
                                    "score": sc}
                produits.append(f"{fichier} ({len(blob)//1024} Ko)")
                time.sleep(0.4)

            if produits:
                print(f"  [ok]  {slug}: {', '.join(produits)}"); ok += 1
            else:
                print(f"  [--]  {slug}: rien de retenu"); ko += 1
        except Exception as e:
            print(f"  [!!]  {slug}: {e}"); ko += 1
        time.sleep(PAUSE)
    json.dump(credits, open(CREDITS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n{ok} ok / {ko} à revoir  -> {LIBRE}")


if __name__ == "__main__":
    main()
