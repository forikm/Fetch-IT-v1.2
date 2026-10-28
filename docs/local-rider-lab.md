# Local Rider application lab

Start both real apps with `node scripts/rider-demo-lab.cjs start` from Customer. Rider runs at http://localhost:3011 and Staff Admin at http://localhost:3022/login. Stop with `node scripts/rider-demo-lab.cjs stop`; restarting reuses the saved lab data. The launcher leaves existing servers and .env files alone.

The lab uses a dedicated randomly named PostgreSQL schema in the configured database server, not the production public schema. Both local apps share that schema and a local document directory. No Firebase users, real emails, Vercel Blob objects, payments or production accounts are created. `local-rider-lab/` is ignored by Git.

In Rider, choose Become a rider, then **Use demo · new random rider**. Each registration step has its own **Use demo** button. Account verifies using the real code flow with a local captured inbox. Vehicle randomizes Motorcycle, Tricycle or Car and Delivery, Passenger rides or Both. Details use fictional names and addresses along the Lingayen–Binmaley–Dagupan corridor. Documents generate readable sample forms bearing DEMO / NOT VALID marks; these are not government credentials. Review fills missing requirements but leaves normal Submit under your control.

Admin has **Use demo staff** on its local login page. Choose Review Admin, Orientation Admin, Activation Admin or Safety Reviewer to test the normal independent-review rules. All use the local-only password `LocalDemo-Only-2026!`; these identities do not exist in production.

To test a rejection/correction, submit in Rider, open the same application in Admin, mark OR **Needs correction**, enter a reason, save the decision, then **Request corrections & email rider**. Rider automatically refreshes while waiting and displays the reason. Accepted items stay locked; Use demo on Documents replaces only flagged or newly required uploads during corrections. Resubmit and verify that the previous version remains in Admin's history. The local inbox captures the correction email instead of sending it.

The demo endpoints require development mode, no Vercel environment, an explicit lab flag, a strictly named schema, matching connection search path, a live database schema check, loopback hostname and same-origin POSTs. Production rejects them even if the flag is accidentally set. The normal authentication, upload validation, application version checks and review permissions still apply. Local demo accounts use `.invalid` addresses and sample documents are permanently marked as test data.

Five existing DEMO-only generated portraits from `output/demo-activity-20261024/photos/demo-only/` are required by this workspace's launcher. They are copied into the private lab directory at startup. Drafts, documents and mail remain there after stopping so testing can resume.

