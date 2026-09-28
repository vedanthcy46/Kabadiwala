import { registerCollector } from '../src/services/collectors.service.js';
import { createLot, initiateHandover, confirmHandover } from '../src/services/handover.service.js';
import { sendOffer, acceptOffer, getOffersByLot } from '../src/services/offers.service.js';
import { listRecyclers } from '../src/services/recyclerCrud.service.js';
import { pool, query } from '../src/db.js';

const CITIES = [
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { name: 'Mumbai', lat: 19.0760, lng: 72.8777 },
  { name: 'Delhi', lat: 28.7041, lng: 77.1025 },
  { name: 'Hyderabad', lat: 17.3850, lng: 78.4867 },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Pune', lat: 18.5204, lng: 73.8567 },
  { name: 'Kolkata', lat: 22.5726, lng: 88.3639 },
  { name: 'Ahmedabad', lat: 23.0225, lng: 72.5714 }
];

const CATEGORIES = ['PCB', 'CRT', 'Battery', 'Motor', 'Cable', 'Plastic', 'LCD'];
const NAMES = ['Rahul', 'Anil', 'Rajesh', 'Suresh', 'Priya', 'Sunita', 'Vikram', 'Deepa', 'Ramesh', 'Kavita', 'Manoj', 'Neha', 'Amit', 'Pooja', 'Sanjay'];
const SURNAMES = ['Kumar', 'Sharma', 'Singh', 'Patil', 'Reddy', 'Rao', 'Das', 'Gupta', 'Verma', 'Naidu'];

const random = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomFloat = (min, max) => Math.random() * (max - min) + min;
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

async function seed() {
  console.log('Starting seed...');

  // Fetch some recyclers to match against
  const recyclersResult = await listRecyclers({ limit: 100 });
  const allRecyclers = recyclersResult.recyclers;
  console.log(`Found ${allRecyclers?.length || 0} recyclers in DB.`);

  if (!allRecyclers || allRecyclers.length === 0) {
    console.error('No recyclers found! Seed recyclers first or check database.');
    process.exit(1);
  }

  // Generate 40-50 collectors
  const numCollectors = randomInt(40, 50);
  console.log(`Creating ${numCollectors} mock collectors...`);

  let totalLots = 0;
  let totalHandovers = 0;

  for (let i = 0; i < numCollectors; i++) {
    const city = random(CITIES);
    const lat = city.lat + randomFloat(-0.1, 0.1);
    const lng = city.lng + randomFloat(-0.1, 0.1);
    const name = `${random(NAMES)} ${random(SURNAMES)}`;
    
    // Register collector
    let collectorObj;
    try {
      const res = await registerCollector({
        name,
        phone: `+9198${randomInt(10000000, 99999999)}`,
        operating_location: city.name,
        latitude: lat,
        longitude: lng,
        preferred_language: random(['en', 'hi', 'mr', 'kn', 'ta', 'te'])
      });
      collectorObj = res.collector;
      console.log(`[${i+1}/${numCollectors}] Created collector ${collectorObj.id} (${name} in ${city.name})`);
    } catch (e) {
      console.error('Failed to create collector:', e.message);
      continue;
    }

    // Create 1-4 lots for this collector
    const numLots = randomInt(1, 4);
    for (let j = 0; j < numLots; j++) {
      const category = random(CATEGORIES);
      const weight = randomFloat(2, 50).toFixed(1);
      
      try {
        const { lot } = await createLot({
          collector_id: collectorObj.id,
          category,
          sub_category: 'Mixed',
          description: `Collected from local households in ${city.name}`,
          image_ref: 'https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg', // dummy image, bypassing upload
          approx_weight_kg: weight,
          condition: 'used',
          source_type: 'household',
          location: city.name,
          collection_lat: lat,
          collection_lng: lng
        });
        
        totalLots++;

        // Randomly progress this lot through the workflow
        // 10% stay quoted, 20% match and get offer, 30% offer accepted, 40% full handover
        const randState = Math.random();
        
        if (randState > 0.1) {
          // Find a recycler in this city, or just any recycler that accepts this material
          const recycler = allRecyclers.find(r => r.materials_accepted?.includes(category) && (r.facility_location?.includes(city.name) || Math.random() > 0.5)) || random(allRecyclers);
          
          const price = parseFloat(weight) * randomInt(20, 150);
          
          const offer = await sendOffer({
            lot_id: lot.lot_id,
            recycler_id: recycler.id,
            offered_price: price,
            offer_valid_until: new Date(Date.now() + 86400000).toISOString()
          });

          if (randState > 0.3) {
            await acceptOffer(offer.id);

            if (randState > 0.6) {
              const handover = await initiateHandover({
                lot_id: lot.lot_id,
                collector_id: collectorObj.id,
                recycler_id: recycler.id,
                photo_refs: ['https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg'],
                weight_kg: weight,
                gps_lat: lat,
                gps_lng: lng,
                handover_location: recycler.facility_location || city.name
              });

              await confirmHandover(handover.handover_reference_number, recycler.id, {
                final_weight_kg: weight,
                final_price_paid: price,
                payment_mode: 'cash',
                gps_lat: recycler.latitude || lat,
                gps_lng: recycler.longitude || lng
              });
              
              totalHandovers++;
            }
          }
        }
      } catch (e) {
        console.error(`  Failed lot for collector ${collectorObj.id}:`, e.message);
      }
    }
  }

  console.log(`\n✅ Seed complete!`);
  console.log(`- Collectors: ${numCollectors}`);
  console.log(`- Lots created: ${totalLots}`);
  console.log(`- Fully completed handovers: ${totalHandovers}`);
  
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
