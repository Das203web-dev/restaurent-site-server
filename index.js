const express = require('express');
const app = express();
require('dotenv').config();
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

const cors = require('cors');
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());



const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.sen9pye.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const menuCollection = client.db('RestaurentDB').collection('menuDB');
        const cartCollection = client.db('RestaurentDB').collection('cartDB');
        const userCollection = client.db('RestaurentDB').collection('userDB');
        const paymentCollection = client.db('RestaurentDB').collection('payments');


        // middleware for verify token
        const verifyToken = (req, res, next) => {
            if (!req.headers.authorization) {
                return res.status(401).send({ message: "Access Denied" });
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: "Access not granted" })
                }
                req.decoded = decoded;
                next()
            })
        }
        // verify admin after verify token 
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === "Admin";
            if (!isAdmin) {
                return res.status(401).send({ message: "forbidden access" })
            }
            next()
        }
        app.get('/menu', async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result)
        })
        app.post('/menu', verifyToken, verifyAdmin, async (req, res) => {
            const newItem = req.body
            const result = await menuCollection.insertOne(newItem);
            res.send(result)
        })
        app.get('/menu/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: id };
            const result = await menuCollection.findOne(query);
            res.send(result)
        })
        app.patch('/menu/:id', async (req, res) => {
            const item = req.body;
            const id = req.params.id;
            const filter = { _id: id };
            const updateDoc = {
                $set: {
                    name: item.name,
                    recipe: item.recipe,
                    category: item.category,
                    price: item.price,
                    image: item.image
                }
            }
            const result = await menuCollection.updateOne(filter, updateDoc);
            res.send(result)

        })
        app.delete('/menu/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: id };
            const result = await menuCollection.deleteOne(query);
            res.send(result)
        })
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN, { expiresIn: "1h" });
            res.send({ token })
        })
        app.get('/cart', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const result = await cartCollection.find(query).toArray();
            res.send(result)
        })
        app.post('/cart', async (req, res) => {
            const body = req.body;
            const result = await cartCollection.insertOne(body);
            res.send(result)
        })
        app.delete('/cart/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result)
        })
        app.post('/users', async (req, res) => {
            const userInfo = req.body;
            const query = { email: userInfo.email };
            const isEmailExist = await userCollection.findOne(query);
            if (isEmailExist) {
                return res.send({ message: "user already exist", insertedId: null })
            }
            const result = await userCollection.insertOne(userInfo);
            res.send(result)
        })
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result)
        })

        // apis for admin 
        app.get('/user/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            // console.log(email)
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: "Unauthorized user" })
            }
            const query = { email: email };
            const user = await userCollection.findOne(query);
            // console.log('getting user from admin api', user)
            let admin = false;
            if (user) {
                admin = user?.role === 'Admin'
            }
            // console.log('get admin', admin)
            res.send({ admin })

        })
        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'Admin'
                }
            }
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result)
        })
        app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await userCollection.deleteOne(query);
            res.send(result)
        })
        // api for stripe 
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })
        // payment related api 
        app.post('/payment', verifyToken, async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentCollection.insertOne(payment);
            const query = {
                _id: {
                    $in: payment.cartIds.map(id => new ObjectId(id))
                }
            }
            const result = await cartCollection.deleteMany(query)
            res.send({ paymentResult, result })

        })
        app.get('/paymentHistory/:email', verifyToken, async (req, res) => {
            const userEmail = req.params.email;
            const query = { email: userEmail };
            if (userEmail !== req.decoded.email) {
                return res.status(401).send({ message: "forbidden" })
            }
            const result = await paymentCollection.find(query).toArray();
            res.send(result)
        });
        // stats api 
        app.get('/stats', verifyToken, verifyAdmin, async (req, res) => {
            const customers = await userCollection.estimatedDocumentCount()
            const products = await menuCollection.estimatedDocumentCount()
            const orders = await cartCollection.estimatedDocumentCount()
            const revenue = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalRevenue: { $sum: '$price' }
                    }
                }
            ]).toArray();
            const finalRevenue = revenue.length > 0 ? revenue[0].totalRevenue : 0;
            res.send({ customers, products, orders, finalRevenue })
        })

        // order stats api 
        app.get('/order-stats', verifyToken, verifyAdmin, async (req, res) => {
            const orderStats = await paymentCollection.aggregate([
                {
                    $unwind: '$menuIds'
                },
                {
                    $lookup: {
                        from: 'menuDB',
                        localField: 'menuIds',
                        foreignField: '_id',
                        as: 'menuItems'
                    }
                },
                {
                    $unwind: '$menuItems'
                },
                {
                    $group: {
                        _id: '$menuItems.category',
                        quantity: {
                            $sum: 1
                        },
                        revenue: { $sum: '$menuItems.price' }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        category: '$_id',
                        quantity: '$quantity',
                        revenue: '$revenue'
                    }
                }
            ]).toArray();
            res.send(orderStats)
        })
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('hello world')
})
app.listen(port, () => {
    console.log(`port is running on ${port}`)
})