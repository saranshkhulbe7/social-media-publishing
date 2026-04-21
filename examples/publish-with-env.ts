import { publish } from "../src/index";

const result = await publish(
  {
    kind: "photos",
    caption: "New product shots are live.",
    media: [
      "https://example.com/photo-1.jpg",
      "https://example.com/photo-2.jpg",
    ],
    platformOverrides: {
      facebook: {
        pageId: "your-facebook-page-id",
      },
    },
  },
  {
    x: true,
    instagram: true,
    facebook: false,
  },
  {
    onProgress(event) {
      console.log(`[${event.stage}] ${event.message}`);
    },
  },
);

console.log(JSON.stringify(result, null, 2));
