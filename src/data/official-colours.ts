// The finishes each model was officially sold in by Apple / Samsung (UK range, including the online-exclusive
// finishes). Names follow the manufacturer's own wording. Used by `npm run seed:colours` to give every product a
// colour list, so the storefront can make shoppers pick one before adding to the basket.
//
// Sources: apple.com and samsung.com/uk product pages, MacRumors / GSMArena launch coverage, retailer guides.
export interface OfficialColour { name: string; hex: string }
const c = (name: string, hex: string): OfficialColour => ({ name, hex });

// Shared swatches
const BLACK = '#1F2020', WHITE = '#F5F5F0', SILVER = '#E3E4E6', GRAPHITE = '#54524F', GREEN = '#B7D1B5', PURPLE = '#CDB8E0', PINK = '#F2C8D4', YELLOW = '#F7E58A', RED = '#BF1B2C', MINT = '#B8DFC9', LAVENDER = '#C9B8E6', CREAM = '#F1E9D6';

export const OFFICIAL_COLOURS: Record<string, OfficialColour[]> = {
  // ── Apple ──
  'iPhone 11': [c('Black', BLACK), c('White', WHITE), c('Green', '#AEE1CD'), c('Yellow', '#FFE681'), c('Purple', '#D1CDDA'), c('Red', RED)],
  'iPhone 11 Pro': [c('Midnight Green', '#4E5851'), c('Space Gray', '#535150'), c('Silver', SILVER), c('Gold', '#FAD7BD')],
  'iPhone 11 Pro Max': [c('Midnight Green', '#4E5851'), c('Space Gray', '#535150'), c('Silver', SILVER), c('Gold', '#FAD7BD')],
  'iPhone 12': [c('Black', BLACK), c('White', WHITE), c('Red', RED), c('Green', '#AFD3B8'), c('Blue', '#3F6E8C'), c('Purple', '#D1C4E9')],
  'iPhone 12 mini': [c('Black', BLACK), c('White', WHITE), c('Red', RED), c('Green', '#AFD3B8'), c('Blue', '#3F6E8C'), c('Purple', '#D1C4E9')],
  'iPhone 12 Pro': [c('Graphite', '#52514F'), c('Silver', SILVER), c('Gold', '#F1DCC4'), c('Pacific Blue', '#2E4A5C')],
  'iPhone 12 Pro Max': [c('Graphite', '#52514F'), c('Silver', SILVER), c('Gold', '#F1DCC4'), c('Pacific Blue', '#2E4A5C')],
  'iPhone 13': [c('Midnight', '#232A31'), c('Starlight', '#F0E5D8'), c('Blue', '#276787'), c('Pink', '#FAD6D2'), c('Red', RED), c('Green', '#394C38')],
  'iPhone 13 mini': [c('Midnight', '#232A31'), c('Starlight', '#F0E5D8'), c('Blue', '#276787'), c('Pink', '#FAD6D2'), c('Red', RED), c('Green', '#394C38')],
  'iPhone 13 Pro': [c('Graphite', '#54524F'), c('Gold', '#FAE7CF'), c('Silver', SILVER), c('Sierra Blue', '#9BB5CE'), c('Alpine Green', '#576856')],
  'iPhone 13 Pro Max': [c('Graphite', '#54524F'), c('Gold', '#FAE7CF'), c('Silver', SILVER), c('Sierra Blue', '#9BB5CE'), c('Alpine Green', '#576856')],
  'iPhone 14': [c('Midnight', '#232A31'), c('Starlight', '#F0E5D8'), c('Purple', '#E6DDEA'), c('Blue', '#A0B4C7'), c('Red', RED), c('Yellow', '#F9E479')],
  'iPhone 14 Plus': [c('Midnight', '#232A31'), c('Starlight', '#F0E5D8'), c('Purple', '#E6DDEA'), c('Blue', '#A0B4C7'), c('Red', RED), c('Yellow', '#F9E479')],
  'iPhone 14 Pro': [c('Space Black', '#2F2E2D'), c('Silver', SILVER), c('Gold', '#F4E8CE'), c('Deep Purple', '#4B3F59')],
  'iPhone 14 Pro Max': [c('Space Black', '#2F2E2D'), c('Silver', SILVER), c('Gold', '#F4E8CE'), c('Deep Purple', '#4B3F59')],
  'iPhone 15': [c('Black', '#3A3C3E'), c('Blue', '#CFD9E0'), c('Green', '#CAD4C5'), c('Yellow', '#F0E9BB'), c('Pink', '#EBD3D4')],
  'iPhone 15 Plus': [c('Black', '#3A3C3E'), c('Blue', '#CFD9E0'), c('Green', '#CAD4C5'), c('Yellow', '#F0E9BB'), c('Pink', '#EBD3D4')],
  'iPhone 15 Pro': [c('Black Titanium', '#3B3B3C'), c('White Titanium', '#E8E8E4'), c('Blue Titanium', '#3E4757'), c('Natural Titanium', '#BEB8AF')],
  'iPhone 15 Pro Max': [c('Black Titanium', '#3B3B3C'), c('White Titanium', '#E8E8E4'), c('Blue Titanium', '#3E4757'), c('Natural Titanium', '#BEB8AF')],
  'iPhone 16': [c('Black', '#3C3D3F'), c('White', '#F2F2F0'), c('Pink', '#F4C1D5'), c('Teal', '#B4CFD1'), c('Ultramarine', '#9AACEC')],
  'iPhone 16 Plus': [c('Black', '#3C3D3F'), c('White', '#F2F2F0'), c('Pink', '#F4C1D5'), c('Teal', '#B4CFD1'), c('Ultramarine', '#9AACEC')],
  'iPhone 16 Pro': [c('Black Titanium', '#3B3B3C'), c('White Titanium', '#E8E8E4'), c('Natural Titanium', '#BEB8AF'), c('Desert Titanium', '#BFA48F')],
  'iPhone 16 Pro Max': [c('Black Titanium', '#3B3B3C'), c('White Titanium', '#E8E8E4'), c('Natural Titanium', '#BEB8AF'), c('Desert Titanium', '#BFA48F')],
  'iPhone 17': [c('Black', '#2B2B2D'), c('White', '#F4F4F2'), c('Mist Blue', '#B6C8D9'), c('Sage', '#B4C2A8'), c('Lavender', '#CFC3E0')],
  'iPhone Air': [c('Space Black', '#2E2E30'), c('Cloud White', '#F3F3F1'), c('Light Gold', '#E7D7B8'), c('Sky Blue', '#BBD3E6')],
  'iPhone 17 Pro': [c('Silver', '#E5E5E7'), c('Cosmic Orange', '#E0702C'), c('Deep Blue', '#27364F')],
  'iPhone 17 Pro Max': [c('Silver', '#E5E5E7'), c('Cosmic Orange', '#E0702C'), c('Deep Blue', '#27364F')],
  'iPhone 17e': [c('Black', '#2B2B2D'), c('White', '#F4F4F2'), c('Soft Pink', '#F1CFD6')],
  'iPhone 18 Pro': [c('Deep Black', '#1E1E20'), c('Silver', '#E5E5E7'), c('Glacier Blue', '#A9C3D9'), c('Burgundy', '#5C1F2E')],
  'iPhone 18 Pro Max': [c('Deep Black', '#1E1E20'), c('Silver', '#E5E5E7'), c('Glacier Blue', '#A9C3D9'), c('Burgundy', '#5C1F2E')],

  // ── Samsung ──
  'Galaxy Note 20': [c('Mystic Bronze', '#C69A7D'), c('Mystic Gray', '#7C7F83'), c('Mystic Green', '#6E8C7E')],
  'Galaxy Note 20 Ultra': [c('Mystic Bronze', '#C69A7D'), c('Mystic Black', BLACK), c('Mystic White', WHITE)],
  'Galaxy S20': [c('Cosmic Gray', '#6C6E72'), c('Cloud Blue', '#A8C4E0'), c('Cloud Pink', '#F0CFD3')],
  'Galaxy S20 Ultra': [c('Cosmic Black', BLACK), c('Cosmic Gray', '#6C6E72'), c('Cloud White', WHITE)],
  'Galaxy S21 5G': [c('Phantom Gray', '#6F7074'), c('Phantom White', WHITE), c('Phantom Violet', '#B9A6D8'), c('Phantom Pink', '#F1C9D0')],
  'Galaxy S21 FE 5G': [c('Graphite', GRAPHITE), c('White', WHITE), c('Olive', '#A8B28A'), c('Lavender', LAVENDER)],
  'Galaxy S21 Plus': [c('Phantom Black', BLACK), c('Phantom Silver', '#DADCDF'), c('Phantom Violet', '#B9A6D8')],
  'Galaxy S21 Ultra': [c('Phantom Black', BLACK), c('Phantom Silver', '#DADCDF'), c('Phantom Titanium', '#8A8780'), c('Phantom Navy', '#2B3A55'), c('Phantom Brown', '#6B4B3A')],
  'Galaxy S22': [c('Phantom Black', BLACK), c('Phantom White', WHITE), c('Green', '#7C9A86'), c('Pink Gold', '#E9C5B5'), c('Graphite', GRAPHITE), c('Sky Blue', '#A9CBE6'), c('Violet', '#B9A6D8'), c('Cream', CREAM)],
  'Galaxy S22 Plus': [c('Phantom Black', BLACK), c('Phantom White', WHITE), c('Green', '#7C9A86'), c('Pink Gold', '#E9C5B5'), c('Graphite', GRAPHITE), c('Sky Blue', '#A9CBE6'), c('Violet', '#B9A6D8'), c('Cream', CREAM)],
  'Galaxy S22 Ultra': [c('Phantom Black', BLACK), c('Phantom White', WHITE), c('Burgundy', '#6B1F2F'), c('Green', '#5E7A68'), c('Graphite', GRAPHITE), c('Sky Blue', '#A9CBE6'), c('Red', RED)],
  'Galaxy S23 FE': [c('Mint', MINT), c('Cream', CREAM), c('Graphite', GRAPHITE), c('Purple', PURPLE), c('Indigo', '#4B5A8C'), c('Tangerine', '#F2994A')],
  'Galaxy S23 Plus': [c('Phantom Black', BLACK), c('Cream', CREAM), c('Green', '#7C9A86'), c('Lavender', LAVENDER), c('Graphite', GRAPHITE), c('Lime', '#D4E27A'), c('Sky Blue', '#A9CBE6'), c('Red', RED)],
  'Galaxy S23 Ultra': [c('Phantom Black', BLACK), c('Cream', CREAM), c('Green', '#5E7A68'), c('Lavender', LAVENDER), c('Graphite', GRAPHITE), c('Lime', '#D4E27A'), c('Sky Blue', '#A9CBE6'), c('Red', RED)],
  'Galaxy S24': [c('Onyx Black', BLACK), c('Marble Gray', '#C9C9CB'), c('Cobalt Violet', '#B8AEDB'), c('Amber Yellow', '#F1D58B'), c('Jade Green', '#7FB09A'), c('Sapphire Blue', '#3F5E94'), c('Sandstone Orange', '#E9A06B')],
  'Galaxy S24 Plus': [c('Onyx Black', BLACK), c('Marble Gray', '#C9C9CB'), c('Cobalt Violet', '#B8AEDB'), c('Amber Yellow', '#F1D58B'), c('Jade Green', '#7FB09A'), c('Sapphire Blue', '#3F5E94'), c('Sandstone Orange', '#E9A06B')],
  'Galaxy S24 Ultra': [c('Titanium Black', '#2E2E30'), c('Titanium Gray', '#8E8E90'), c('Titanium Violet', '#8F83A6'), c('Titanium Yellow', '#D9C887'), c('Titanium Green', '#7F9A88'), c('Titanium Blue', '#5A7391'), c('Titanium Orange', '#D0895A')],
  'Galaxy S24 FE': [c('Blue', '#7F9DC7'), c('Graphite', GRAPHITE), c('Gray', '#A5A7AA'), c('Mint', MINT), c('Yellow', YELLOW)],
  'Galaxy S25': [c('Navy', '#2D3A57'), c('Mint', MINT), c('Icy Blue', '#BBD7EA'), c('Silver Shadow', '#C9CBCE'), c('Coral Red', '#E9695C'), c('Blue Black', '#1C2230'), c('Pink Gold', '#E9C5B5')],
  'Galaxy S25 Edge': [c('Titanium Silver', '#C9CBCE'), c('Titanium Jet Black', '#1E1F21'), c('Titanium Icy Blue', '#BBD7EA')],
  'Galaxy S25 Ultra': [c('Titanium Silverblue', '#9FB1C2'), c('Titanium Black', '#2E2E30'), c('Titanium Gray', '#8E8E90'), c('Titanium Whitesilver', '#E3E3E1'), c('Titanium Jadegreen', '#7F9A88'), c('Titanium Jetblack', '#1E1F21'), c('Titanium Pinkgold', '#E3C3B3')],
  'Galaxy S25 FE': [c('Navy', '#2D3A57'), c('Jet Black', '#1E1F21'), c('White', WHITE), c('Icy Blue', '#BBD7EA')],
  'Galaxy S26': [c('Cobalt Violet', '#B8AEDB'), c('Sky Blue', '#B3D1EA'), c('Black', BLACK), c('White', WHITE), c('Silver Shadow', '#C9CBCE'), c('Pink Gold', '#E9C5B5')],
  'Galaxy S26 Plus': [c('Cobalt Violet', '#B8AEDB'), c('Sky Blue', '#B3D1EA'), c('Black', BLACK), c('White', WHITE), c('Silver Shadow', '#C9CBCE'), c('Pink Gold', '#E9C5B5')],
  'Galaxy S26 Ultra': [c('Cobalt Violet', '#B8AEDB'), c('Sky Blue', '#B3D1EA'), c('Black', BLACK), c('White', WHITE), c('Silver Shadow', '#C9CBCE'), c('Pink Gold', '#E9C5B5')],
  'Galaxy Z Flip 4': [c('Graphite', GRAPHITE), c('Pink Gold', '#E9C5B5'), c('Blue', '#8FB0D6'), c('Bora Purple', '#B9A0D6')],
  'Galaxy Z Flip 5': [c('Mint', MINT), c('Graphite', GRAPHITE), c('Cream', CREAM), c('Lavender', LAVENDER), c('Gray', '#A5A7AA'), c('Blue', '#8FB0D6'), c('Green', GREEN), c('Yellow', YELLOW)],
  'Galaxy Z Flip 6': [c('Silver Shadow', '#C9CBCE'), c('Blue', '#8FB0D6'), c('Mint', MINT), c('Yellow', YELLOW), c('Crafted Black', '#1E1F21'), c('White', WHITE), c('Peach', '#F3C3A5')],
  'Galaxy Z Fold 4': [c('Graygreen', '#8C9A8F'), c('Phantom Black', BLACK), c('Beige', '#E4D6BF'), c('Burgundy', '#6B1F2F')],
  'Galaxy Z Fold 5': [c('Phantom Black', BLACK), c('Icy Blue', '#BBD7EA'), c('Cream', CREAM), c('Gray', '#A5A7AA'), c('Blue', '#8FB0D6')],
  'Galaxy Z Fold 6': [c('Silver Shadow', '#C9CBCE'), c('Pink', PINK), c('Navy', '#2D3A57'), c('Crafted Black', '#1E1F21'), c('White', WHITE)],
  'Galaxy A17 5G': [c('Black', BLACK), c('Blue', '#5B7FB0'), c('Gray', '#8E9094')],
  'Galaxy A25 5G': [c('Blue Black', '#1F2733'), c('Blue', '#5B7FB0'), c('Yellow', YELLOW), c('Light Blue', '#B9D3EA')],
  'Galaxy A26 5G': [c('Black', BLACK), c('White', WHITE), c('Mint', MINT), c('Peach Pink', '#F4C7B8')],
  'Galaxy A34 5G': [c('Awesome Graphite', GRAPHITE), c('Awesome Silver', '#D5D7DA'), c('Awesome Lime', '#D4E27A'), c('Awesome Violet', '#B9A6D8')],
  'Galaxy A37 5G': [c('Awesome Charcoal', '#3A3B3E'), c('Awesome Lavender', LAVENDER), c('Awesome White', WHITE), c('Awesome Graygreen', '#8C9A8F')],
  'Galaxy A56 5G': [c('Awesome Graphite', GRAPHITE), c('Awesome Lightgray', '#D5D7DA'), c('Awesome Olive', '#A8B28A'), c('Awesome Pink', PINK)],
};
