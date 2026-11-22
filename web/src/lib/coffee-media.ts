export interface DrinkPhoto {
  src: string;
  alt: string;
}

const DRINK_PHOTOS: Record<string, DrinkPhoto> = {
  "double-espresso": {
    src: "/images/drinks/espresso.webp",
    alt: "Chikmagalur double espresso with rich tiger-striped crema in matte ceramic cup",
  },
  "iced-oat-latte": {
    src: "/images/drinks/iced-oat-latte.webp",
    alt: "Iced oat velvet latte with espresso swirling into chilled oat milk",
  },
  "iced-almond-americano": {
    src: "/images/drinks/iced-oat-latte.webp",
    alt: "Iced almond cloud latte in fluted glass on stoneware coaster",
  },
  "vietnamese-iced-coffee": {
    src: "/images/drinks/iced-oat-latte.webp",
    alt: "Saigon condensed iced coffee swirled over ice",
  },
  "salted-caramel-cold-latte": {
    src: "/images/drinks/iced-oat-latte.webp",
    alt: "Salted caramel iced latte layered with espresso and cold milk",
  },
  "classic-cold-brew": {
    src: "/images/drinks/cold-brew.webp",
    alt: "18-hour slow cold brew poured over a clear ice block on dark walnut",
  },
  "iced-americano": {
    src: "/images/drinks/cold-brew.webp",
    alt: "Iced long black pulled over chilled filtered water and ice",
  },
  "coconut-cold-brew": {
    src: "/images/drinks/cold-brew.webp",
    alt: "Coastal coconut cold brew floated with silky coconut milk",
  },
  "espresso-tonic": {
    src: "/images/drinks/espresso-tonic.webp",
    alt: "Nagpur espresso tonic layered over sparkling tonic with orange zest",
  },
  "iced-hibiscus-spritz": {
    src: "/images/drinks/espresso-tonic.webp",
    alt: "Hibiscus orange cold spritz over ice with citrus peel",
  },
  "oat-flat-white": {
    src: "/images/drinks/cappuccino.webp",
    alt: "Barista oat flat white with silky micro-foam rosetta in stoneware cup",
  },
  "classic-cappuccino": {
    src: "/images/drinks/cappuccino.webp",
    alt: "Artisan cappuccino with glossy micro-foam in warm stoneware cup",
  },
  "cardamom-jaggery-cortado": {
    src: "/images/drinks/cappuccino.webp",
    alt: "Delhi cardamom jaggery cortado in handmade stoneware cup",
  },
  "hazelnut-mocha": {
    src: "/images/drinks/cappuccino.webp",
    alt: "Dark cocoa hazelnut mocha topped with steamed micro-foam",
  },
  "decaf-vanilla-almond-latte": {
    src: "/images/drinks/cappuccino.webp",
    alt: "Decaf vanilla almond latte with delicate rosetta foam",
  },
  "assam-masala-chai": {
    src: "/images/drinks/cappuccino.webp",
    alt: "Slow-simmered Assam chai in warm cream stoneware",
  },
  "coorg-v60-pourover": {
    src: "/images/drinks/pourover.webp",
    alt: "Coorg single-origin V60 pour-over in glass server beside stoneware cup",
  },
  "iced-oat-matcha": {
    src: "/images/drinks/matcha-chai.webp",
    alt: "Ceremonial Uji iced oat matcha swirling over ice in clear glass",
  },
  "butter-croissant": {
    src: "/images/drinks/bakery.webp",
    alt: "Golden laminated butter croissant on warm cream ceramic plate",
  },
  "almond-danish": {
    src: "/images/drinks/bakery.webp",
    alt: "Toasted almond frangipane danish on stoneware plate",
  },
  "vegan-banana-loaf": {
    src: "/images/drinks/bakery.webp",
    alt: "Walnut espresso banana loaf served on matte stoneware",
  },
  "avocado-sourdough": {
    src: "/images/drinks/bakery.webp",
    alt: "Artisanal bakery tartine served on warm cream stoneware",
  },
};

export function getDrinkPhoto(item: {
  id?: string;
  menuItemId?: string;
  category?: string;
  name?: string;
}): DrinkPhoto {
  const key = item.id || item.menuItemId || "";
  if (key && DRINK_PHOTOS[key]) {
    return DRINK_PHOTOS[key];
  }
  const cat = item.category || "";
  if (cat === "cold_coffee") {
    return {
      src: "/images/drinks/iced-oat-latte.webp",
      alt: item.name ? `${item.name} served cold in glass` : "Specialty iced coffee",
    };
  }
  if (cat === "tea_matcha") {
    return {
      src: "/images/drinks/matcha-chai.webp",
      alt: item.name ? `${item.name} specialty tea` : "Specialty matcha and tea",
    };
  }
  if (cat === "bakery") {
    return {
      src: "/images/drinks/bakery.webp",
      alt: item.name ? `${item.name} fresh from café bakery` : "Artisanal café pastry",
    };
  }
  if (cat === "signature") {
    return {
      src: "/images/drinks/pourover.webp",
      alt: item.name ? `${item.name} single-origin signature pour` : "Single-origin pour-over",
    };
  }
  return {
    src: "/images/drinks/espresso.webp",
    alt: item.name ? `${item.name} crafted espresso` : "Specialty espresso pour",
  };
}
