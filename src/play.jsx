import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Ably from "ably";

export default function Play() {
  const { id } = useParams();
  const guestId = parseInt(id);

  const [label, setLabel] = useState("");
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const ably = new Ably.Realtime.Promise({
      authUrl: "/.netlify/functions/ably-token",
    });

    const channel = ably.channels.get("gameshow");

    channel.subscribe("update", (msg) => {
      if (msg.data.guestId === guestId) {
        setLabel(msg.data.label || "");
      }
    });

    return () => {
      ably.close();
    };
  }, [guestId]);

  const submitAnswer = async () => {
    const ably = new Ably.Realtime.Promise({
      authUrl: "/.netlify/functions/ably-token",
    });

    const channel = ably.channels.get("gameshow");

    await channel.publish("answer", {
      guestId,
      answer,
      timestamp: Date.now(),
    });

    setSubmitted(true);
  };

  const room = "testgameshow123"; // change later

  const vdoUrl = `https://vdo.ninja/?room=${room}&push=guest${guestId}&webcam&autostart`;

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif" }}>
      <h2>{label || `Guest ${guestId}`}</h2>

      <iframe
        src={vdoUrl}
        allow="camera; microphone; autoplay; fullscreen"
        style={{ width: "100%", height: "300px", border: "none" }}
      />

      <div style={{ marginTop: 20 }}>
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Enter your answer"
          style={{ width: "100%", padding: 10, fontSize: 16 }}
          disabled={submitted}
        />

        <button
          onClick={submitAnswer}
          disabled={submitted}
          style={{
            marginTop: 10,
            width: "100%",
            padding: 12,
            fontSize: 18,
            background: submitted ? "gray" : "green",
            color: "white",
          }}
        >
          {submitted ? "Submitted ✅" : "Submit Answer"}
        </button>
      </div>
    </div>
  );
}
