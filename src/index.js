const express = require("express");
const Pool = require("pg").Pool;
const { nanoid } = require("nanoid");
const expressSanitizer = require("express-sanitizer");
const dotenv = require("dotenv");

dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PWD,
  port: process.env.DB_PORT,
});

const app = express();

const port = 8000;

app.use(express.json()); // api request 의 json 요청을 parse
app.use(express.urlencoded({ extended: true })); // 객체형태의 요청에서 중첩객체를 허용. optional.
app.use(expressSanitizer());

// define api handlers.
app.post("/create-vote", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    const voteId = nanoid(10);
    const postId = parseInt(req.body.postId);
    const voteTitle = req.body.voteTitle;
    const voteDesc = req.body.voteDesc || ""; // optional. it can be null.
    const voteItemsText = req.body.voteItems; // parsing string and separate.
    const voteItems = JSON.parse(JSON.stringify(voteItemsText));
    const tomorrow = Date.now() + 86400 * 1000;
    const voteExpiredAt = req.body.voteExpiredAt || new Date(tomorrow); // default is 24 hour.

    // 항목 제한 및 글자수 제한을 체크하기 위한 flags.
    if (
      Object.keys(voteItems).length < 2 ||
      Object.keys(voteItems).length > 100
    ) {
      return res
        .status(200)
        .json({ message: "투표 항목은 2개에서 100개 사이여야 합니다." });
    }
    if (voteTitle.length > 100) {
      return res
        .status(200)
        .json({ message: "투표 제목은 100자 이내여야 합니다." });
    }
    if (voteDesc.length > 10000) {
      return res
        .status(200)
        .json({ message: "투표 설명은 10000자 이내여야 합니다." });
    }
    let flag = false;
    for (const ele of voteItems) {
      if (ele.length > 50) {
        flag = true;
        break;
      }
    }
    if (flag) {
      return res
        .status(200)
        .json({ message: "각 투표 항목은 50자 이내여야 합니다." });
    }

    await pool.query(
      "insert into votes (post_id, vote_id, vote_title, vote_desc, user_id, vote_expired_at) values ($1, $2, $3, $4, $5, $6)",
      [postId, voteId, voteTitle, voteDesc, userId, voteExpiredAt]
    );

    let qrstr = "";
    voteItems.forEach((ele, idx) => {
      if (idx == voteItems.length - 1) {
        qrstr += `('${voteId}', '${ele}', ${idx})`;
      } else {
        qrstr += `('${voteId}', '${ele}', ${idx}),`;
      }
    });

    await pool.query(
      `INSERT INTO vote_items (vote_id,content,item_order) VALUES ${qrstr}`
    );

    return res.status(200).json({ voteId: voteId });
  } catch (e) {
    console.log("cerate-vote error: ", e);
    return res
      .status(500)
      .json({ message: "죄송합니다. 서버에서 오류가 발생했습니다." });
  }
});

app.post("/read-vote", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    const voteId = req.body.voteId;

    // 투표의 존재성 체크
    const vtqr = await pool.query(
      `SELECT * FROM votes WHERE vote_id =$1 LIMIT 1`,
      [voteId]
    );
    if (vtqr.rows.length < 1) {
      return res.status(404).json({ message: "존재하지 않는 투표입니다." });
    }

    // 해당 유저가 투표를 했는지 안했는지 체크
    const tfqr = await pool.query(
      `SELECT * FROM user_vote_items WHERE user_id=$1 AND vote_id=$2`,
      [userId, voteId]
    );

    // 투표항목에 대한 정보 가져오는 쿼리
    const joinqr = await pool.query(
      `SELECT vote_items.content, vote_items.item_order, vote_items.id AS item_Id, coalesce(cnt, 0) AS count FROM vote_items LEFT OUTER JOIN (SELECT vote_item_id, count (*) AS cnt FROM user_vote_items WHERE vote_id=$1 GROUP BY vote_item_id ) AS counts ON counts.vote_item_id=vote_items.id WHERE vote_items.vote_id=$2`,
      [voteId, voteId]
    );

    const voteCreator = vtqr.rows[0].user_id;
    const voteTitle = vtqr.rows[0].vote_title;
    const voteDesc = vtqr.rows[0].vote_desc;
    // timezone 문제.
    // js 에서 vote_expired_at 객체를 자동적으로 전환해버려서
    // json 으로 리턴할때 UTC+0시와 UTC+9 시의 차이만큼 시차가 생겨날때가 있습니다.
    // db 에는 20일 11시로 저장돼 있다면
    // 출력할때는 20일 2시로 출력되는 경우가 있습니다.
    // docker compose 설정에서 postgresql Timezone 설정을 asia/seoul 로 하면 문제가 없는듯 하지만
    // 혹시 timezone 문제가 생길수 있으니,
    // 그런 문제를 보정해주기 위해 getTime() 함수를 써서 unix timestamp 를 밀리세컨드 단위로 얻은뒤
    // 9시간 어치 시차를 보정해주고
    // 다시 new Date 객체를 이용해 string 으로 바꿔줍니다.
    // 당근마켓 내부에서 timezone 을 어떻게 다루는지 몰라서 일단 각주 처리로 남겨 놓습니다.
    // 투표 마감시간을 다루는 것은 unix timestamp 로 변환해서 비교하기때문에 timezone 문제가 생기지 않습니다.
    const voteExpiredAtTemp = vtqr.rows[0].vote_expired_at;
    const voteExpiredAt = new Date(voteExpiredAtTemp.getTime()); // + 3600 * 1000 * 9

    const voteItems = joinqr.rows;
    voteItems.sort(function (a, b) {
      return a.item_order - b.item_order;
    });

    const isVoted = tfqr.rows.length > 0;

    return res.status(200).json({
      voteCreator,
      voteTitle,
      voteDesc,
      voteExpiredAt,
      isVoted,
      voteItems,
    });
  } catch (e) {
    console.log("read-vote error: ", e);
    return res
      .status(500)
      .json({ message: "죄송합니다. 서버에서 오류가 발생했습니다." });
  }
});

app.post("/select-vote", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"];
    const voteId = req.body.voteId;
    const voteItemId = req.body.voteItemId;
    // 만약 유효하지 않은 항목에 투표한다면 faliure 를 반환해야함.
    const checkValidity = await pool.query(
      `SELECT vote_items.id AS vote_item_id, votes.vote_expired_at FROM vote_items LEFT JOIN votes ON votes.vote_id = vote_items.vote_id WHERE vote_items.vote_id = $1 AND vote_items.id = $2`,
      [voteId, voteItemId]
    );
    if (checkValidity.rows.length < 1) {
      return res
        .status(200)
        .json({ result: "failure", message: "유효하지 않은 항목입니다." });
    }
    // 유효기간을 넘긴 투표를 방지해야함.
    if (Date.parse(checkValidity.rows[0].vote_expired_at) - Date.now() < 0) {
      return res
        .status(200)
        .json({ result: "failure", message: "이미 마감된 투표입니다." });
    }
    // 중복 투표를 방지해야함.
    const checkDoubleVote = await pool.query(
      `SELECT * FROM user_vote_items WHERE user_id=$1 AND vote_id=$2 LIMIT 1`,
      [userId, voteId]
    );
    if (checkDoubleVote.rows.length > 0) {
      return res
        .status(200)
        .json({ result: "failure", message: "이미 투표하셨습니다." });
    }

    await pool.query(
      `INSERT INTO user_vote_items (user_id, vote_id,vote_item_id) VALUES ($1, $2,$3)`,
      [userId, voteId, voteItemId]
    );
    return res.status(200).json({ result: "success" });
  } catch (e) {
    console.log("select-vote error: ", e);
    return res
      .status(500)
      .json({ message: "죄송합니다. 서버에서 오류가 발생했습니다." });
  }
});

app.listen(port, () => {
  console.log(`서버 실행!`);
});

module.exports = app;
