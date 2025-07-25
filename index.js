const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const axios = require('axios');
const app = express();
const PORT = 3000;

// ✅ Firebase service account key
const serviceAccount = require('./firebase-service-account.json');

// ✅ Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://centralize-524ea-default-rtdb.asia-southeast1.firebasedatabase.app'
});
const db = admin.database();

// ✅ Middleware
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// ✅ PayMongo secret key
const SECRET_KEY = 'sk_test_4tM5Z5GLBfeMU7tTQYaRYRMW';

// ✅ Create PayMongo Checkout Session
app.post('/create-checkout', async (req, res) => {
  const { contact } = req.body;
  const userRef = db.ref(`devices/${contact}`);

  try {
    const snapshot = await userRef.once('value');
    const userData = snapshot.val();

    if (!userData) return res.status(404).json({ error: 'User not found' });

    const kwh = userData.kwh || 0;
    const price = userData.Price || 0;
    const amount = kwh * price * 100;

    console.log(`✅ DEBUG: kwh=${kwh}, price=${price}, amount=${amount}`);

    if (amount <= 0) return res.status(400).json({ error: 'Amount must be greater than 0' });

    const response = await axios.post(
      'https://api.paymongo.com/v1/checkout_sessions',
      {
        data: {
          attributes: {
            send_email_receipt: true,
            show_description: true,
            show_line_items: true,
            line_items: [
              {
                name: 'Electric Bill',
                amount: amount,
                currency: 'PHP',
                quantity: 1
              }
            ],
            payment_method_types: ['gcash', 'card', 'paymaya'],
            description: `Payment for ${contact}`,
            statement_descriptor: 'Centralize',
            reference_number: contact, // ✅ No more replace()
            redirect: {
              success: 'https://google.com',
              failed: 'https://google.com'
            }
          }
        }
      },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(SECRET_KEY + ':').toString('base64')}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const checkoutUrl = response.data.data.attributes.checkout_url;
    res.json({ url: checkoutUrl });
  } catch (err) {
    console.error('💥 Error creating checkout:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ✅ Webhook Handler
app.post('/webhook', express.json(), async (req, res) => {
  try {
    const body = req.body;

    console.log('📦 Webhook received:', JSON.stringify(body, null, 2));

    const eventType = body.data.attributes.event_type;

    if (eventType === 'payment.paid') {
      const reference = body.data.attributes.data.attributes.reference_number;
      console.log(`🔍 Reference: ${reference}`); // Show reference

      const userRef = db.ref(`devices/${reference}`);
      const now = new Date();
      const timestamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;

      await Promise.all([
        userRef.child('Paid Status').set(true),
        userRef.child('kwh').set(0)
      ]);

      await userRef.child('history').push({
        timestamp,
        message: `₱ paid successfully`
      });

      console.log(`✔ Firebase updated for ${reference}`);
    } else {
      console.log(`⚠️ Unhandled event type: ${eventType}`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Webhook Error:', error.message);
    res.sendStatus(400);
  }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});