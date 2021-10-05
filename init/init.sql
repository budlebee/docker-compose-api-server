CREATE TABLE IF NOT EXISTS votes (
    id serial PRIMARY KEY, 
    user_id TEXT, 
    post_id BIGINT NOT NULL, 
    vote_id TEXT NOT NULL, 
    vote_title TEXT NOT NULL, 
    vote_desc TEXT, 
    vote_expired_at TIMESTAMP
); 

CREATE TABLE IF NOT EXISTS vote_items (
    id serial primary key, 
    vote_id TEXT NOT NULL, 
    content TEXT NOT NULL, 
    item_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_vote_items (
    id serial primary key, 
    user_id TEXT, 
    vote_id TEXT, 
    vote_item_id INTEGER
);
