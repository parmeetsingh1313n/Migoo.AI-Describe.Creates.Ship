import { Inngest } from "inngest";

// Create a client to send and receive events
export const inngest = new Inngest({ 
  id: "ai-video-course-generator",
  eventKey: process.env.INNGEST_EVENT_KEY || "local_dev_key"
});
