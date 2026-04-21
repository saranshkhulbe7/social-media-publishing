import { createPublisherService } from "../src/index";

const publisher = createPublisherService({
  apiKey: process.env.UPLOAD_POST_API_KEY ?? "your-api-key",
  profile: process.env.UPLOAD_POST_PROFILE ?? "your-profile",
});

const result = await publisher.publish(
  {
    kind: "text",
    caption: "Shipping an update today.",
    platformOverrides: {
      facebook: {
        pageId: "your-facebook-page-id",
        linkUrl: "https://example.com/article",
      },
    },
  },
  {
    x: true,
    instagram: false,
    facebook: true,
  },
);

console.log(JSON.stringify(result, null, 2));
