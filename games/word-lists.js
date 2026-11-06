// Shared word lists for the word games (Name, Place, Animal, Thing and Atlas), plus the matching helpers.
// The lists are original compilations of everyday facts: common first names, real places, animals and
// household objects. Within each letter the more familiar words come first (computers use that order:
// easy ones reach for the obvious words, hard ones for rarer ones).
//
// Matching is forgiving: case, accents, spaces, hyphens and apostrophes don't matter, common spelling
// variants are folded together (Pooja / Puja, Lakshmi / Laxmi, Kavita / Kavitha), and a single slip in a
// longer word still counts (Bhubaneshwar for Bhubaneswar).

const split = (t) => t.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);

export const NAMES = split(`
Aarav,Aditi,Aditya,Ajay,Akash,Amit,Anil,Anita,Anjali,Arjun,Arun,Asha,Ashok,Ayesha,Alice,Adam,Amelia,Anna,Andrew,Alex,Abhishek,Akshay,Alok,Amar,Amrita,Anand,Ananya,Ankit,Anusha,Aruna,Aamir,Abdul,Ahmed,Ali,Amy,Anthony,Alan,Albert,Amanda,Angela,Arthur,Ava,Aaron,Abigail,Ayaan,Aryan,Avni,Alicia,Akira,Antonio
Bharat,Bhavna,Bala,Bina,Bindu,Ben,Bella,Bob,Brian,Bhaskar,Balaji,Bipin,Babita,Basant,Bhavesh,Bhumi,Bilal,Bushra,Barbara,Benjamin,Beth,Bill,Bonnie,Bruce,Brandon,Bianca,Boris,Brijesh,Bhuvan,Bruno
Chetan,Chitra,Chandan,Chandra,Charu,Chirag,Charles,Charlotte,Chloe,Chris,Chaitanya,Chanchal,Chinmay,Chhavi,Christopher,Claire,Clara,Colin,Connor,Caroline,Catherine,Carlos,Carmen,Cecilia,Celine,Charlie,Cyrus,Chen,Camila
Deepak,Deepa,Divya,Dev,Dinesh,Daniel,David,Diana,Dhruv,Devika,Durga,Darshan,Deepika,Dhanush,Dilip,Disha,Daksh,Danish,Daisy,Dylan,Dominic,Dorothy,Dennis,Derek,Diego,Dina,Dimple,Dhara,Daphne
Esha,Ekta,Eshan,Emma,Emily,Edward,Ethan,Eklavya,Elango,Elena,Eli,Elijah,Eliza,Ella,Ellen,Eric,Eva,Evelyn,Edwin,Emil,Erin,Ezra,Ebrahim,Elif,Esther,Elsa
Farhan,Fatima,Faisal,Farah,Fiona,Frank,Felix,Firoz,Falguni,Faiz,Fred,Florence,Frances,Freya,Faith,Finn,Francis,Felipe,Fernando,Frida,Farida,Fawad,Fabian
Ganesh,Gita,Gaurav,Gauri,Girish,Gopal,Govind,Gayatri,George,Grace,Gautam,Gagan,Gunjan,Garima,Gurpreet,Gary,Gabriel,Gemma,Gina,Gloria,Gordon,Greg,Gwen,Gustav,Giovanni,Gulshan,Gargi
Hari,Harish,Harsh,Hema,Hemant,Harry,Hannah,Helen,Henry,Harsha,Himani,Hitesh,Hrithik,Harpreet,Hasan,Heena,Hamid,Hugo,Holly,Hazel,Hector,Heidi,Howard,Hiroshi,Huda,Hansa,Hemlata
Ishaan,Isha,Indira,Imran,Irfan,Indu,Ishita,Isaac,Ian,Iris,Irene,Isabella,Ivan,Ivy,Ida,Ingrid,Inaya,Ila,Iqbal,Ira,Isla,Ibrahim,Igor,Indrajit,Ishwar
Jaya,Jai,Jatin,Jyoti,Jack,James,John,Jane,Jagdish,Janaki,Jasmine,Jaspreet,Jeevan,Jitendra,Juhi,Javed,Jacob,Jason,Jennifer,Jessica,Joseph,Joy,Julia,Julian,Justin,Jade,Jasper,Jonah,Jorge,Juan,Jahnavi,Jayant
Karan,Kavya,Kiran,Krishna,Kabir,Kajal,Kamal,Kavita,Kunal,Kumar,Kishore,Komal,Kriti,Kartik,Kalpana,Khushi,Keerthi,Kamala,Kate,Kevin,Kelly,Karen,Kyle,Kenji,Karim,Klaus,Kim,Kofi,Kusum,Ketan
Lakshmi,Lata,Lalit,Leela,Liam,Laura,Lily,Lucy,Lokesh,Lavanya,Laxman,Leena,Lalita,Luke,Leo,Lena,Linda,Lisa,Logan,Louis,Lucas,Luis,Lara,Layla,Lina,Lorenzo,Lekha,Lohit
Mahesh,Manish,Manoj,Meena,Meera,Mohan,Mohit,Monica,Mukesh,Maya,Maria,Mark,Mary,Michael,Mia,Murali,Madhu,Mansi,Megha,Mihir,Mira,Mohammed,Mustafa,Matthew,Max,Molly,Martin,Mason,Marco,Mei,Musa,Madhuri,Malini
Naveen,Neha,Nikhil,Nisha,Nitin,Nandini,Noah,Nora,Nancy,Naresh,Neelam,Nilesh,Nirmala,Nithya,Navya,Nakul,Nasreen,Noor,Nadia,Natalie,Nathan,Nick,Nicole,Nina,Neil,Naomi,Nelson,Naoki,Nupur,Nagesh
Om,Omkar,Ojas,Omar,Olivia,Oliver,Oscar,Owen,Olga,Otto,Ophelia,Orla,Opal,Odette,Oren,Ojasvi,Oorja,Osman,Ola,Octavia,Olive
Pooja,Priya,Prakash,Pranav,Priyanka,Prem,Pradeep,Parvati,Pallavi,Payal,Pankaj,Pratik,Preeti,Puneet,Pavan,Prerna,Parth,Patrick,Paul,Paula,Peter,Penny,Philip,Phoebe,Paolo,Pedro,Pablo,Petra,Poonam,Prisha
Qadir,Quentin,Quinn,Qasim,Queenie
Rahul,Raj,Rajesh,Ravi,Rekha,Rohan,Rohit,Riya,Ramesh,Rakesh,Rina,Ritu,Roshni,Ruchi,Rupa,Radha,Rani,Rashmi,Rishi,Rajan,Rahim,Rizwan,Rachel,Rebecca,Richard,Robert,Rose,Ruby,Ryan,Rosa,Raul,Rafael,Rita,Roy,Reyansh,Rukmini
Sachin,Sanjay,Sunil,Suresh,Sunita,Sita,Shreya,Sneha,Sonia,Sara,Sarah,Sam,Swati,Sameer,Sanya,Shivani,Shruti,Siddharth,Suman,Sapna,Sarita,Shankar,Shalini,Sahil,Salman,Sana,Samuel,Sophia,Sophie,Steven,Simon,Susan,Sean,Sofia,Stella,Sakura,Santiago,Sudha,Seema
Tanvi,Tarun,Tara,Tina,Tom,Thomas,Tanya,Tejas,Tushar,Trisha,Tapan,Tulsi,Tanmay,Tasneem,Tim,Tony,Tessa,Theo,Tyler,Tobias,Teresa,Taro,Tariq,Tejaswini,Trupti
Uma,Uday,Usha,Umesh,Urmila,Ujjwal,Utkarsh,Urvashi,Umar,Uri,Ulysses,Una,Ursula,Ulrich,Usman,Uttam,Upasana,Unnati
Varun,Vijay,Vikram,Vinod,Vivek,Vidya,Victor,Victoria,Vandana,Vani,Vasant,Veena,Vinay,Vishal,Vaishali,Vimala,Vikas,Vihaan,Vincent,Vera,Violet,Vanessa,Valentina,Viktor,Vanya,Vedika
William,Walter,Wendy,Wasim,Waheeda,Wahid,Wayne,Will,Wanda,Wesley,Willow,Winston,Wilma,Wei,Wren,Warren,Wyatt,Wajid,Wilson
Xavier,Xena,Ximena,Xander
Yash,Yamini,Yogesh,Yuvraj,Yusuf,Yasmin,Yogita,Yashoda,Yamuna,Yatin,Yuki,Yara,Yvonne,Yosef,Yolanda,Yan,Yuri,Yasir,Yashika
Zara,Zoya,Zain,Zoe,Zubin,Zeenat,Zack,Zaid,Zahra,Zubair
`);

// Countries; Indian states and union territories; Indian cities; world cities; a few well-known states
// and provinces elsewhere.
export const PLACES = split(`
Afghanistan,Albania,Algeria,Andorra,Angola,Antigua and Barbuda,Argentina,Armenia,Australia,Austria,Azerbaijan,Bahamas,Bahrain,Bangladesh,Barbados,Belarus,Belgium,Belize,Benin,Bhutan,Bolivia,Bosnia and Herzegovina,Botswana,Brazil,Brunei,Bulgaria,Burkina Faso,Burundi
Cambodia,Cameroon,Canada,Cape Verde,Central African Republic,Chad,Chile,China,Colombia,Comoros,Congo,Costa Rica,Croatia,Cuba,Cyprus,Czechia,Denmark,Djibouti,Dominica,Dominican Republic,Ecuador,Egypt,El Salvador,Equatorial Guinea,Eritrea,Estonia,Eswatini,Ethiopia,England
Fiji,Finland,France,Gabon,Gambia,Georgia,Germany,Ghana,Greece,Grenada,Guatemala,Guinea,Guinea-Bissau,Guyana,Greenland,Haiti,Honduras,Hungary,Iceland,India,Indonesia,Iran,Iraq,Ireland,Israel,Italy,Ivory Coast
Jamaica,Japan,Jordan,Kazakhstan,Kenya,Kiribati,Kosovo,Kuwait,Kyrgyzstan,Laos,Latvia,Lebanon,Lesotho,Liberia,Libya,Liechtenstein,Lithuania,Luxembourg
Madagascar,Malawi,Malaysia,Maldives,Mali,Malta,Marshall Islands,Mauritania,Mauritius,Mexico,Micronesia,Moldova,Monaco,Mongolia,Montenegro,Morocco,Mozambique,Myanmar
Namibia,Nauru,Nepal,Netherlands,New Zealand,Nicaragua,Niger,Nigeria,North Korea,North Macedonia,Norway,Oman,Pakistan,Palau,Palestine,Panama,Papua New Guinea,Paraguay,Peru,Philippines,Poland,Portugal,Qatar
Romania,Russia,Rwanda,Saint Lucia,Samoa,San Marino,Saudi Arabia,Scotland,Senegal,Serbia,Seychelles,Sierra Leone,Singapore,Slovakia,Slovenia,Solomon Islands,Somalia,South Africa,South Korea,South Sudan,Spain,Sri Lanka,Sudan,Suriname,Sweden,Switzerland,Syria
Taiwan,Tajikistan,Tanzania,Thailand,Timor-Leste,Togo,Tonga,Trinidad and Tobago,Tunisia,Turkey,Turkmenistan,Tuvalu,Uganda,Ukraine,United Arab Emirates,United Kingdom,United States,Uruguay,Uzbekistan,Vanuatu,Vatican City,Venezuela,Vietnam,Wales,Yemen,Zambia,Zimbabwe
Andhra Pradesh,Arunachal Pradesh,Assam,Bihar,Chhattisgarh,Goa,Gujarat,Haryana,Himachal Pradesh,Jharkhand,Karnataka,Kerala,Madhya Pradesh,Maharashtra,Manipur,Meghalaya,Mizoram,Nagaland,Odisha,Punjab,Rajasthan,Sikkim,Tamil Nadu,Telangana,Tripura,Uttar Pradesh,Uttarakhand,West Bengal
Andaman and Nicobar Islands,Chandigarh,Dadra and Nagar Haveli and Daman and Diu,Delhi,Jammu and Kashmir,Ladakh,Lakshadweep,Puducherry
Agra,Ahmedabad,Ajmer,Akola,Alappuzha,Aligarh,Almora,Alwar,Ambala,Amravati,Amritsar,Anantapur,Asansol,Aurangabad,Ayodhya,Aizawl,Agartala,Arrah,Ambikapur
Bengaluru,Bhopal,Bhubaneswar,Bareilly,Belagavi,Ballari,Bhagalpur,Bharatpur,Bhavnagar,Bhilai,Bhuj,Bikaner,Bilaspur,Bodh Gaya,Bokaro,Bathinda,Baramati,Barmer,Begusarai,Bhilwara,Bhiwandi,Vijayapura
Chennai,Coimbatore,Cuttack,Chandrapur,Cuddalore,Chittoor,Chhindwara,Chikmagalur,Cherrapunji
Dehradun,Darjeeling,Dhanbad,Dharwad,Dibrugarh,Dispur,Durgapur,Dwarka,Daman,Davanagere,Deoghar,Dewas,Diu
Erode,Ernakulam,Etawah,Eluru,Faridabad,Firozabad,Gandhinagar,Gangtok,Gaya,Ghaziabad,Gorakhpur,Kalaburagi,Guntur,Gurugram,Guwahati,Gwalior,Gadag,Gondia
Hyderabad,Haridwar,Hisar,Hubballi,Hampi,Hosur,Howrah,Indore,Imphal,Itanagar,Idukki
Jaipur,Jabalpur,Jaisalmer,Jalandhar,Jalgaon,Jammu,Jamnagar,Jamshedpur,Jhansi,Jodhpur,Junagadh,Jorhat
Kolkata,Kanpur,Kochi,Kota,Kakinada,Kannur,Kanchipuram,Karnal,Kohima,Kolhapur,Kollam,Kottayam,Kozhikode,Kurnool,Kurukshetra,Kadapa,Karimnagar,Khammam,Kharagpur,Kodaikanal,Kanyakumari,Kargil
Lucknow,Ludhiana,Latur,Leh,Lonavala,Mumbai,Madurai,Mangaluru,Mathura,Meerut,Moradabad,Munnar,Mussoorie,Muzaffarpur,Mysuru,Malda,Manali,Margao,Mohali,Mount Abu
Nagpur,Nashik,Noida,New Delhi,Nainital,Nanded,Navi Mumbai,Nellore,Nagercoil,Nizamabad,Nalanda,Nagaon
Ooty,Ongole,Orchha,Panaji,Patna,Pune,Puri,Prayagraj,Panipat,Patiala,Palakkad,Pathankot,Porbandar,Pushkar
Raipur,Rajkot,Ranchi,Rishikesh,Ratlam,Rohtak,Rourkela,Rajahmundry,Rameswaram,Raigad
Surat,Shimla,Srinagar,Shillong,Sagar,Saharanpur,Salem,Sangli,Satara,Siliguri,Solapur,Sambalpur,Secunderabad,Shirdi,Silchar,Sivakasi,Somnath
Thane,Thanjavur,Thiruvananthapuram,Thrissur,Tiruchirappalli,Tirunelveli,Tirupati,Tiruppur,Tezpur,Tinsukia,Tumakuru
Udaipur,Ujjain,Udupi,Unnao,Udhampur,Ulhasnagar,Vadodara,Varanasi,Vellore,Vijayawada,Visakhapatnam,Vapi,Valsad,Vasco da Gama,Vrindavan,Vizianagaram
Warangal,Wardha,Wayanad,Yavatmal,Yamunanagar,Yanam
Amsterdam,Athens,Auckland,Abu Dhabi,Accra,Addis Ababa,Adelaide,Alexandria,Algiers,Almaty,Amman,Ankara,Antwerp,Atlanta,Austin,Asuncion,Astana,Ashgabat
Bangkok,Beijing,Berlin,Barcelona,Boston,Baghdad,Baku,Bali,Baltimore,Beirut,Belfast,Belgrade,Bern,Birmingham,Bogota,Brasilia,Bratislava,Brisbane,Bristol,Brussels,Bucharest,Budapest,Buenos Aires,Busan,Bordeaux,Bologna,Bilbao,Bonn
Cairo,Chicago,Colombo,Cape Town,Calgary,Canberra,Caracas,Casablanca,Copenhagen,Cologne,Chittagong,Cancun,Cardiff,Cebu,Chengdu,Chongqing,Christchurch,Cleveland
Dubai,Dhaka,Dublin,Doha,Dakar,Dallas,Damascus,Dar es Salaam,Darwin,Denver,Detroit,Durban,Dusseldorf,Dresden
Edinburgh,Edmonton,Eindhoven,Essen,Entebbe,Exeter,El Paso
Florence,Frankfurt,Fukuoka,Fez,Faisalabad,Funchal,Freetown
Geneva,Glasgow,Genoa,Guangzhou,Guadalajara,Gothenburg,Granada,Galway,Gdansk
Hamburg,Hanoi,Havana,Helsinki,Hong Kong,Houston,Harare,Hiroshima,Ho Chi Minh City,Honolulu,Hobart,Hangzhou,Haifa,Hamilton,Hanover
Istanbul,Islamabad,Isfahan,Inverness,Indianapolis,Innsbruck,Incheon,Ibiza,Iquitos,Izmir
Jakarta,Jerusalem,Johannesburg,Jeddah,Jacksonville,Jaffna,Juba,Jeju
Kabul,Karachi,Kathmandu,Kyoto,Kuala Lumpur,Kampala,Khartoum,Kyiv,Kigali,Kingston,Kinshasa,Kobe,Kuwait City,Krakow,Kandy,Kazan
London,Lisbon,Los Angeles,Lagos,Lahore,La Paz,Las Vegas,Leeds,Leipzig,Lima,Liverpool,Luanda,Lusaka,Lyon,Lucerne,Lhasa,Ljubljana
Madrid,Moscow,Melbourne,Manila,Mexico City,Miami,Milan,Manchester,Marrakesh,Marseille,Mecca,Medina,Minsk,Mogadishu,Monterrey,Montevideo,Montreal,Munich,Muscat,Male,Malaga,Mombasa,Monte Carlo,Mandalay
New York,Nairobi,Naples,Nagoya,Nassau,New Orleans,Nice,Nicosia,Nottingham,Novosibirsk,Nuremberg,Nanjing,Nagasaki
Oslo,Osaka,Ottawa,Oxford,Oakland,Odessa,Orlando,Omaha,Oran
Paris,Prague,Perth,Philadelphia,Phnom Penh,Phoenix,Pretoria,Porto,Pyongyang,Palermo,Pisa,Portland,Port Louis,Pokhara,Peshawar
Quito,Quebec City,Qingdao,Quetta,Queenstown
Rome,Riyadh,Rio de Janeiro,Rabat,Reykjavik,Riga,Rotterdam,Rawalpindi,Recife
Sydney,Seoul,Shanghai,San Francisco,Santiago,Stockholm,Salzburg,San Diego,Sao Paulo,Sapporo,Sarajevo,Seattle,Seville,Shenzhen,Sofia,Stuttgart,Suva,Salvador,Samarkand
Tokyo,Toronto,Tehran,Taipei,Tallinn,Tangier,Tashkent,Tbilisi,Tel Aviv,Thimphu,Toulouse,Tripoli,Tunis,Turin,Toledo
Ulaanbaatar,Utrecht,Uppsala,Venice,Vienna,Vancouver,Valencia,Vientiane,Vilnius,Valletta,Verona,Vladivostok
Washington,Warsaw,Wellington,Windhoek,Winnipeg,Wuhan,Xian,Xiamen,Yangon,Yokohama,Yerevan,Yaounde,Zurich,Zagreb,Zanzibar
Alaska,Arizona,California,Colorado,Florida,Hawaii,Nevada,Ohio,Oregon,Texas,Utah,Virginia,Ontario,Quebec,Queensland,Tasmania,Victoria,Bavaria,Yukon,Tibet,Siberia,Kashmir
Aberdeen,Acapulco,Bergen,Brighton,Cambridge,Cusco,Dundee,Gibraltar,Ghent,Lausanne,Lille,Luxor,Malmo,Memphis,Nantes,Nashville,Oaxaca,Odense,Olympia,Sacramento,Tampa,Valparaiso,Wollongong,Wroclaw,Yogyakarta,Yazd,Zermatt,Faro,Fujairah,Ipoh,Irkutsk,Eilat,Ubud
`);

// Other names people use for places in the list (old names, short forms, other spellings).
export const PLACE_ALIASES = {
  Bombay: 'Mumbai', Madras: 'Chennai', Calcutta: 'Kolkata', Bangalore: 'Bengaluru', Mysore: 'Mysuru', Mangalore: 'Mangaluru',
  Poona: 'Pune', Baroda: 'Vadodara', Benares: 'Varanasi', Banaras: 'Varanasi', Kashi: 'Varanasi', Allahabad: 'Prayagraj',
  Gurgaon: 'Gurugram', Trivandrum: 'Thiruvananthapuram', Trichy: 'Tiruchirappalli', Calicut: 'Kozhikode', Cochin: 'Kochi',
  Vizag: 'Visakhapatnam', Belgaum: 'Belagavi', Bellary: 'Ballari', Gulbarga: 'Kalaburagi', Hubli: 'Hubballi', Bijapur: 'Vijayapura',
  Tumkur: 'Tumakuru', Udhagamandalam: 'Ooty', Pondicherry: 'Puducherry', Orissa: 'Odisha', Uttaranchal: 'Uttarakhand',
  Panjim: 'Panaji', Simla: 'Shimla', Quilon: 'Kollam', Alleppey: 'Alappuzha', Tanjore: 'Thanjavur', Kanchi: 'Kanchipuram',
  Andaman: 'Andaman and Nicobar Islands', 'Andaman Islands': 'Andaman and Nicobar Islands', 'Jammu Kashmir': 'Jammu and Kashmir',
  USA: 'United States', America: 'United States', 'United States of America': 'United States', US: 'United States',
  UK: 'United Kingdom', Britain: 'United Kingdom', 'Great Britain': 'United Kingdom', UAE: 'United Arab Emirates', Emirates: 'United Arab Emirates',
  Holland: 'Netherlands', Burma: 'Myanmar', Rangoon: 'Yangon', Ceylon: 'Sri Lanka', Persia: 'Iran', Siam: 'Thailand',
  "Cote d'Ivoire": 'Ivory Coast', 'Czech Republic': 'Czechia', Swaziland: 'Eswatini', 'East Timor': 'Timor-Leste', Macedonia: 'North Macedonia',
  Korea: 'South Korea', Bosnia: 'Bosnia and Herzegovina', Trinidad: 'Trinidad and Tobago', Vatican: 'Vatican City', Kiev: 'Kyiv',
  Peking: 'Beijing', Saigon: 'Ho Chi Minh City', Oporto: 'Porto', Bogata: 'Bogota', Marrakech: 'Marrakesh', Fes: 'Fez', Cracow: 'Krakow',
  'Washington DC': 'Washington', NYC: 'New York', 'New York City': 'New York', LA: 'Los Angeles',
  Turkiye: 'Turkey', Dilli: 'Delhi', 'Delhi NCR': 'Delhi', Makkah: 'Mecca', 'Ulan Bator': 'Ulaanbaatar',
  'Nur-Sultan': 'Astana', Gothenberg: 'Gothenburg', Munchen: 'Munich', Koln: 'Cologne', Wien: 'Vienna',
};

export const ANIMALS = split(`
ant,antelope,alligator,alpaca,anteater,armadillo,albatross,anaconda,aardvark,ape,angelfish,anchovy,arctic fox,adder,addax,agouti,avocet,axolotl,arctic tern,african grey parrot,asian elephant
bear,bee,bat,buffalo,butterfly,beaver,bison,badger,baboon,beetle,bull,bulbul,boar,bobcat,blackbird,buzzard,barracuda,barn owl,bandicoot,beluga,blue whale,budgerigar,bullfrog,bluebird,blue jay,bald eagle,bearded dragon,beagle,bittern,blackbuck,bonobo,bulldog
cat,cow,camel,cheetah,crocodile,crow,chicken,cobra,crab,chimpanzee,canary,caracal,caribou,caterpillar,catfish,centipede,chameleon,chinchilla,chipmunk,clam,cockatoo,cockroach,cod,condor,cormorant,cougar,coyote,crane,cricket,cuckoo,cuttlefish,capybara,clownfish,cockatiel,collie,crayfish,curlew,chihuahua
dog,donkey,deer,duck,dolphin,dove,dragonfly,dodo,dingo,dachshund,dalmatian,dormouse,dugong,damselfly,drongo,dhole,dik-dik
elephant,eagle,eel,emu,elk,earthworm,echidna,egret,eland,ermine,earwig,eider,elephant seal,emperor penguin
fox,frog,fish,flamingo,falcon,ferret,finch,firefly,fly,flea,flying fox,fruit bat,flounder,fennec fox,frigatebird,fur seal
goat,giraffe,gorilla,goose,gecko,grasshopper,goldfish,gazelle,gaur,gerbil,gharial,gibbon,gnu,gopher,grouse,guinea pig,gull,guppy,grizzly bear,greyhound,gannet,gnat,guanaco,goshawk,grebe
horse,hen,hippopotamus,hamster,hare,hawk,hedgehog,hyena,heron,hornbill,hummingbird,hornet,herring,husky,hoopoe,haddock,halibut,hammerhead shark,hermit crab,honeybee,hoverfly,howler monkey
iguana,ibis,impala,ibex,indri,inchworm,indian roller,irrawaddy dolphin,indian cobra,italian greyhound
jaguar,jackal,jellyfish,jay,jerboa,junglefowl,jackrabbit,jacana,javelina,jungle cat
kangaroo,koala,kingfisher,kite,kiwi,koel,king cobra,komodo dragon,kookaburra,krill,kudu,katydid,killer whale,kinkajou,kestrel
lion,leopard,lizard,llama,lobster,ladybird,lamb,langur,lark,leech,lemming,lemur,locust,loris,lynx,lovebird,lapwing,leopard seal,labrador,lionfish,lungfish
monkey,mouse,mosquito,moose,mole,mongoose,macaw,magpie,mallard,mammoth,manatee,mandrill,mantis,marmot,meerkat,mink,moth,mule,mynah,mackerel,marlin,minnow,mudskipper,musk deer,manta ray,millipede,mussel,mustang
nightingale,newt,narwhal,nilgai,numbat,nuthatch,nightjar,needlefish,nurse shark,nautilus
owl,ostrich,octopus,otter,ox,orangutan,orca,oyster,ocelot,opossum,oriole,oryx,okapi,osprey
parrot,peacock,penguin,pig,pigeon,panda,panther,python,pelican,porcupine,puma,pony,partridge,pheasant,piranha,platypus,polar bear,porpoise,prawn,puffin,pangolin,parakeet,poodle,possum,parrotfish,pufferfish,peregrine falcon,poison dart frog
quail,quokka,quetzal
rabbit,rat,rhinoceros,raccoon,reindeer,robin,rooster,ram,rattlesnake,raven,red panda,ray,red fox,roadrunner,rook,rhea,redstart
snake,sheep,shark,squirrel,snail,spider,sparrow,swan,seal,starfish,salmon,scorpion,salamander,sardine,seahorse,shrew,shrimp,skunk,sloth,slug,squid,stingray,stork,swallow,swordfish,sambar,sea lion,sea turtle,sea urchin,starling,snow leopard,spoonbill,springbok,sunbird,swift
tiger,tortoise,turtle,toad,turkey,termite,tarantula,toucan,trout,tuna,tapir,tamarin,tern,thrush,tick,tiger shark,tree frog,tailorbird,tasmanian devil,terrier
urial,uakari,umbrellabird,urchin,unicornfish
vulture,viper,vole,vampire bat,vervet monkey,vicuna,vaquita
whale,wolf,woodpecker,walrus,wombat,worm,wasp,warthog,weasel,wildebeest,wallaby,wolverine,water buffalo,wren,woodlouse,weaverbird,whippet,wagtail
xerus,x-ray tetra
yak,yellowjacket,yellowfin tuna,yorkshire terrier,yapok
zebra,zebu,zebra finch,zebra shark
`);

export const THINGS = split(`
apple,airplane,alarm clock,album,anchor,apron,armchair,arrow,axe,abacus,accordion,air conditioner,almirah,anklet,antenna,atlas,award,amplifier,aquarium,armour,aerosol can,adapter,arm band,air fryer,aluminium foil,artificial flower
ball,bag,book,bottle,bucket,bed,bell,belt,bench,bicycle,bindi,belan,bhindi,balloon,bangle,basket,bat,battery,binoculars,blanket,blender,bowl,box,bracelet,brick,broom,brush,bulb,button,bread,biscuit,boat,bookmark,briefcase,bubble wrap,bandage,barrel,baton,bead,bean bag,blazer,bolt,boomerang,boots,bow tie,buckle,bunk bed
chair,cup,car,clock,comb,candle,cap,camera,calculator,calendar,cable,cake,carpet,chalk,charger,chappal,charpai,chakla,chapati,coat,coin,compass,computer,cooker,crayon,cupboard,curtain,cushion,crown,cot,coaster,colander,clipboard,cello,cabinet,canoe,carrom board,casserole,ceiling fan,chain,chessboard,chopsticks,clay pot,cloak,cork,crate,crib,cricket bat,crystal,cutlery
door,desk,doll,drum,diary,dice,dish,drawer,dress,dholak,drill,duster,dustbin,diamond,diya,dupatta,dart,doormat,dumbbell,dryer,dollhouse,dosa,dhol,denim jacket,dishwasher,dartboard,deck chair,dental floss,detergent,doorbell,doorknob,drinking straw,drumstick,duffel bag
egg,eraser,envelope,earring,earphones,easel,elevator,escalator,engine,extension cord,eyeliner,emerald,encyclopedia,eggbeater,exercise book,eye drops,electric kettle,eyeshadow,earmuffs,egg cup,electric guitar,exhaust fan
fan,fork,flag,flute,frame,fridge,feather,file,flashlight,flask,folder,fountain pen,frying pan,funnel,football,flower pot,fishing rod,fence,fire extinguisher,freezer,frisbee,fridge magnet,fruit bowl,face mask,fairy lights,felt pen,filter,fire alarm,flip-flops,floor mat
glass,glove,glue,guitar,gift,globe,gate,goggles,garland,game,grater,grinder,gong,gown,gramophone,grill,gem,gas stove,glitter,greeting card,gumboots,garden hose,gas cylinder,gear,glue stick,goblet,golf ball,guitar pick
hat,hammer,helmet,hanger,handbag,hairbrush,hairpin,hammock,handkerchief,harmonium,harp,headphones,heater,hockey stick,hook,hose,hourglass,hairband,handle,handi,highlighter,hot water bottle,hula hoop,hacksaw,hair dryer,hand fan,hard disk,harmonica,headband,hearing aid,hole punch,horn
ink,iron,ice cream,ice cube,idol,inkpot,ironing board,igloo,icebox,invitation card,incense stick,ice skates,idli,ice tray,ice pack,ink pad,idli cooker
jar,jug,jacket,jam,jeans,jewel,jalebi,jhadu,jewellery,jigsaw puzzle,joystick,jersey,jhumka,juicer,jump rope,jeep,jelly,journal,jumper,jukebox,javelin,jack,jerrycan,jet ski,jewellery box,jingle bell
key,kite,kettle,knife,keyboard,keychain,knob,kurta,kadai,kolam,kulfi,kaleidoscope,kayak,ketchup,kennel,kerchief,kit,knapsack,kimono,kazoo,kettlebell,knitting needle,kulhad,kalash
lamp,lock,ladder,lota,ladoo,laptop,lantern,locket,lunchbox,lens,letter,lid,lipstick,lollipop,loudspeaker,luggage,label,lace,leash,lemonade,latch,light bulb,lamp shade,lotion,lab coat,laundry basket,lawn mower,letterbox,life jacket,lute
mirror,mug,map,mat,mask,magnet,magazine,matka,mehndi cone,marble,matchbox,mattress,microphone,microwave,mixer,mobile phone,mop,music box,mosquito net,medal,menu,marker,mitten,motorbike,mortar,mango,mascara,matchstick,measuring tape,megaphone,metronome,milk carton,mixing bowl,mouse pad,muffler
nail,needle,necklace,notebook,newspaper,napkin,net,nail cutter,nose ring,nut,night lamp,nameplate,nutcracker,noodles,nail polish,nib,nail file,neck pillow,necktie,notepad,nozzle,nightgown
oven,oar,orange,ornament,overcoat,organ,ottoman,oil lamp,ointment,onion,origami,opener,oboe,overalls,oil can,oven mitt,oil painting,oxygen cylinder,organiser
pen,pencil,paratha,pakora,papad,pillow,plate,pot,purse,piano,paper,pin,puzzle,perfume,phone,photo frame,pipe,plant,playing cards,plug,pocket watch,printer,pump,pressure cooker,projector,parachute,passport,piggy bank,pizza,paintbrush,pan,paper clip,postcard,padlock,paper bag,paper plane,parasol,pebble,pendant,pestle,pinwheel,pitcher,placemat,pliers,plunger,pouch,pram
quilt,quill,quiver,quartz,quiche
radio,ring,rangoli,rakhi,roti,rope,ruler,rug,racket,rake,razor,refrigerator,remote,ribbon,robot,rocket,rubber band,rucksack,rolling pin,raincoat,rattle,roller skates,rack,rice cooker,rubber stamp,radiator,rain boots,recorder,rice bowl,rickshaw,roller,rubber duck,rudder
spoon,shoe,samosa,sock,soap,sofa,scissors,shirt,saree,saucer,scale,scarf,screw,screwdriver,shampoo,sharpener,shawl,sheet,shelf,shovel,sieve,sink,skateboard,stapler,stool,suitcase,sunglasses,sweater,switch,spectacles,spatula,sandal,sponge,slipper,stethoscope,safety pin,salt shaker,sandpaper,satchel,saxophone,scooter,seesaw,sewing machine,shield,sitar,skipping rope,sledge,snow globe,spade,spinning top,stamp,stopwatch,straw
table,toothbrush,tawa,thali,tanpura,towel,torch,tray,tie,toy,teapot,telephone,television,tent,tablet,tap,tape,telescope,thermometer,thread,tiffin,toaster,toothpaste,trolley,trophy,trumpet,truck,trunk,tumbler,typewriter,tyre,tricycle,tambourine,tabla,tablecloth,teacup,teddy bear,thermos,thimble,tissue,toolbox,toothpick,top,tote bag,traffic cone,treadmill,tripod,trowel,tuning fork
umbrella,ukulele,uniform,utensil,urn,unicycle,undershirt,usb drive,umbrella stand,usb cable,upright piano
vase,van,vada,violin,vacuum cleaner,veil,vest,video game,vessel,visor,vending machine,valve,velvet,vial,vinegar,vanity case,vacuum flask,veena,video camera,vinyl record,volleyball
watch,wallet,window,whistle,wheel,wardrobe,washing machine,water bottle,wig,wire,wok,wrench,wristband,walking stick,wand,wagon,wax,whisk,whiteboard,windmill,wool,wrapping paper,wind chime,walkie-talkie,wall clock,washcloth,watering can,wedding ring,weighing scale,wheelbarrow,wheelchair,windscreen,wooden spoon
xylophone,x-ray
yarn,yo-yo,yacht,yoga mat,yoke,yogurt,yardstick
zip,zipper,zither,zucchini
`);

// Other spellings for words in the lists (both directions are added).
const VARIANTS = {
  airplane: 'aeroplane', jewellery: 'jewelry', armour: 'armor', tyre: 'tire', 'mobile phone': 'cell phone', torch: 'flash light',
  saree: 'sari', refrigerator: 'fridge', television: 'tv', 'yo-yo': 'yoyo', 'ice cream': 'icecream', almirah: 'almira', kadai: 'kadhai',
  hippopotamus: 'hippo', rhinoceros: 'rhino', ladybird: 'ladybug', budgerigar: 'budgie', 'killer whale': 'orca', opossum: 'possum',
  mynah: 'myna', 'grizzly bear': 'grizzly', 'guinea pig': 'cavy', 'sea horse': 'seahorse', 'polar bear': 'ice bear', grey: 'gray',
  mohammed: 'muhammad', mohammad: 'mohammed', mohamed: 'mohammed', aisha: 'ayesha', lakshmi: 'laxmi', jasmine: 'jasmin',
};

/* ---------------- matching ---------------- */

// Accents are dropped (é → e), apostrophes vanish and any other non-letter (hyphens too) becomes a space.
export const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`.]/g, '').replace(/[^a-z]+/g, ' ').trim();
export const squash = (t) => norm(t).replace(/ /g, '');
// A looser key that folds common spelling variants together: Pooja/Puja, Kavitha/Kavita, Laxmi/Lakshmi,
// Vasim/Wasim, Mohamed/Mohammed. Only used to compare; the first letter is always checked on the real text.
export function loose(t) {
  return squash(t).replace(/ph/g, 'f').replace(/x/g, 'ks').replace(/sh/g, 's').replace(/th/g, 't').replace(/dh/g, 'd').replace(/bh/g, 'b').replace(/kh/g, 'k')
    .replace(/gh/g, 'g').replace(/ch/g, 'c').replace(/w/g, 'v').replace(/z/g, 's').replace(/q/g, 'k').replace(/ck/g, 'k')
    .replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/ou/g, 'u').replace(/(.)\1+/g, '$1').replace(/y$/, 'i').replace(/h$/, '');
}
export const firstLetter = (t) => squash(t)[0] || '';
export const lastLetter = (t) => squash(t).slice(-1);

function within1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return diff + (la - i) + (lb - j) <= 1;
}
function within2(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] <= 2;
}

// An index over one list: find(text) gives the list's own spelling of that word (or null).
// plural: also try the word without a plural ending ("monkeys", "boxes", "butterflies").
// A spelling variant or a slip only matches a word with the same first letter as what was typed; the
// explicit aliases (Bombay for Mumbai) match whatever their letter.
export function makeIndex(list, aliases = {}, { plural = false } = {}) {
  const canon = new Map(), named = new Map(), looseMap = new Map(), near = new Map();
  for (const w of list) {
    const s = squash(w), k = loose(w);
    if (!s || canon.has(s)) continue;
    canon.set(s, w);
    if (!looseMap.has(k)) looseMap.set(k, []);
    looseMap.get(k).push(w);
    if (!near.has(s[0])) near.set(s[0], []);
    near.get(s[0]).push([k, w]);
  }
  for (const [a, b] of Object.entries(aliases)) { const w = canon.get(squash(b)); if (w && !canon.has(squash(a))) named.set(squash(a), w); }
  for (const [a, b] of Object.entries(VARIANTS)) {
    const wa = canon.get(squash(a)), wb = canon.get(squash(b));
    if (wa && !canon.has(squash(b))) named.set(squash(b), wa); else if (wb && !canon.has(squash(a))) named.set(squash(a), wb);
  }
  const direct = (s) => canon.get(s) || named.get(s) || null;
  function find(text) {
    const s = squash(text);
    if (!s) return null;
    const f = s[0];
    const stems = plural ? [s, ...new Set([s.replace(/ies$/, 'y'), s.replace(/es$/, ''), s.replace(/s$/, '')])].filter((x, i) => x.length >= 2 && (i === 0 || x !== s)) : [s];
    for (const x of stems) { const w = direct(x); if (w) return w; }
    for (const x of stems) { const w = (looseMap.get(loose(x)) || []).find((c) => squash(c)[0] === f); if (w) return w; }
    const k = loose(s);
    if (k.length < 5) return null;
    for (const [key, w] of near.get(f) || []) if (within1(k, key) || (k.length >= 9 && key.length >= 9 && within2(k, key))) return w;
    return null;
  }
  const has = (text) => !!find(text);
  return { find, has, list };
}

// Does it look like a word someone could mean (letters, a vowel, no keyboard mash)?
export function wordShaped(text) {
  const s = squash(text);
  if (s.length < 3 || s.length > 30) return false;
  if (!/[aeiouy]/.test(s)) return false;
  if (/(.)\1\1/.test(s)) return false;
  if (/[^aeiouy]{5,}/.test(s)) return false;
  return true;
}

// The lists grouped by first letter, in list order (familiar words first).
export function byLetter(list) {
  const out = {};
  for (const w of list) { const c = firstLetter(w); if (c) (out[c] = out[c] || []).push(w); }
  return out;
}
