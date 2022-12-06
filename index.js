const express = require('express');
const app = express()
const cors = require('cors');
const nodemailer = require('nodemailer');
const mg = require('nodemailer-mailgun-transport');


var jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 5000;
require('dotenv').config()
const stripe = require("stripe")(process.env.STRIPE_SECRATE);


app.use(cors())
app.use(express.json())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.z1xe9fw.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function sendBookingEmail(booking) {
    const { email, treatment, appointmentDate, slot } = booking;
    // let transporter = nodemailer.createTransport({
    //     host: 'smtp.sendgrid.net',
    //     port: 587,
    //     auth: {
    //         user: "apikey",
    //         pass: process.env.SENDGRID_API_KEY
    //     }
    // })
    console.log('Send email', email)
    const auth = {
        auth: {
            api_key: process.env.EMAIL_MAILGUN_KEY,
            domain: process.env.EMAIL_MAILGUN_DOMAIN
        }
    }

    const transporter = nodemailer.createTransport(mg(auth));
    transporter.sendMail({
        from: "smmaruf25@gmail.com", // verified sender email
        to: email || 'smmaruf25@gmail.com', // recipient email
        subject: `Your appointment for ${treatment} is confirmed `, // Subject line
        text: "Hello world!", // plain text body
        html: `
        <h4> Your appointment in confirmed </h4>
        <div>
        <p>Your appointment for treatment : ${treatment}</p>
        <p>Please visit us on : ${appointmentDate} at ${slot}</p>
        <p> Thanks from doctors portal </p>
        
</div>        
        `, // html body
    }, function (error, info) {
        if (error) {
            console.log('mail error', error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    });

}

function verifyJWT(req, res, next) {

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access');
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })

}

async function run() {
    try {
        const appointmentOptionCollection = client.db('doctorPortal').collection('appointmentCollection')
        const bookingCollection = client.db('doctorPortal').collection('bookingCollection');
        const usersCollection = client.db('doctorPortal').collection('users');
        const doctorCollection = client.db('doctorPortal').collection('doctors');
        const paymentsCollection = client.db('doctorPortal').collection('payments');

        const verifyAdmin = async (req, res, next) => {
            // console.log('inside verifyAdmin', req.decoded.email)
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail }
            const user = await usersCollection.findOne(query)
            if (user?.role !== 'Admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next()
        }

        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            //  console.log(user, email)
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
                return res.send({ accessToken: token })

            }
            res.status(403).send({ accessToken: '' })
        })
        app.post("/create-payment-intent", async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            // Create a PaymentIntent with the order amount and currency
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                "payment_method_types": [
                    "card"
                ],
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });
        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            const id = payment.bookingId
            const query = {
                _id: ObjectId(id)
            }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transectionId: payment.transectionId
                }
            }
            const updatedResult = await bookingCollection.updateOne(query, updatedDoc)
            res.send(result)
        })

        app.get('/users', async (req, res) => {
            const query = {};
            const users = await usersCollection.find(query).toArray()
            res.send(users)
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            //  console.log(user)
            const result = await usersCollection.insertOne(user);
            res.send(result)
        })

        app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {

            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    role: 'Admin'
                },
            };
            const result = await usersCollection.updateOne(filter, updateDoc, options)
            res.send(result)
        })

        // app.get('/addPrice', async (req, res) => {
        //     const filter = {}
        //     const options = { upsert: true }
        //     const updateDoc = {
        //         $set: {
        //             price: 99
        //         },
        //     };
        //     const result = await appointmentOptionCollection.updateMany(filter, updateDoc, options)
        //     res.send(result)
        // })

        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'Admin' })
        })


        app.get('/appointmentCollection', async (req, res) => {
            const date = req.query.date;
            //console.log(date)
            const query = {}
            const cursor = await appointmentOptionCollection.find(query).toArray()
            const bookingQuery = { appointmentDate: date }
            const alreadyBooked = await bookingCollection.find(bookingQuery).toArray()
            cursor.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name)
                const bookSlot = optionBooked.map(book => book.slot)
                const remaingSlots = option.slots.filter(slot => !bookSlot.includes(slot))
                option.slots = remaingSlots;
                // console.log(bookSlot, remaingSlots.length)
            })
            res.send(cursor)
        })

        app.get('/appointmentSpaciality', async (req, res) => {
            const query = {};
            const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray()
            res.send(result)
        })
        app.get('/v2/appointmentOptions', async (req, res) => {
            const date = req.query.data;
            const options = await appointmentOptionCollection.aggregate([
                {
                    $lookup: {
                        from: 'booking',
                        localField: 'name',
                        foreignField: 'treatment',
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $eq: ['$appointmentDate', date]
                                    }
                                }
                            },
                            {
                                $project: {
                                    name: 1,
                                    slots: 1,
                                    booked: {
                                        $map: {
                                            input: '$booked',
                                            as: 'book',
                                            in: '$$book.slot'
                                        }
                                    }
                                }
                            },
                            {
                                $project: {
                                    name: 1,
                                    slots: {
                                        $setDifference: ['slots', '$booked']
                                    }
                                }
                            }
                        ],
                        as: 'booked'
                    }
                }
            ]).toArray()
            res.send(options)
        })

        app.get('/bookings', verifyJWT, async (req, res) => {
            const email = req.query.email;
            // console.log(req.decoded.email)
            const decodedEmail = req.decoded.email;

            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const query = { email: email };
            const bookings = await bookingCollection.find(query).toArray();
            res.send(bookings);
        })

        app.post('/booking', async (req, res) => {
            const data = req.body;
            const query = {
                appointmentDate: data.appointmentDate,
                treatment: data.treatment,
                email: data.email,
            }
            const alreadyBooked = await bookingCollection.find(query).toArray();
            if (alreadyBooked.length) {
                const message = `You already have a booking on ${data.appointmentDate}`;
                return res.send({ acknowledged: false, message })
            }
            const cursor = await bookingCollection.insertOne(data)
            // send email about appointment confirmation
            sendBookingEmail(data)

            res.send(cursor)
        })
        app.post('/doctors', async (req, res) => {
            const doctor = req.body;
            const result = await doctorCollection.insertOne(doctor);
            res.send(result)
        })
        app.get('/doctors', verifyJWT, verifyAdmin, verifyAdmin, async (req, res) => {
            const query = {}
            const result = await doctorCollection.find(query).toArray()
            res.send(result)
        })
        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const result = await doctorCollection.deleteOne(filter);
            res.send(result)
        })
        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            //console.log(id)
            const filter = { _id: ObjectId(id) }
            const result = await bookingCollection.findOne(filter)
            res.send(result)
        })
    }

    finally {

    }
}
run().catch(err => console.log(err))

app.get('/', (req, res) => {
    res.send('Doctors-portal is running')
})

app.listen(port, () => {
    console.log(`Doctors portal is running onn ${port}`)
})