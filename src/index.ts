export type {
  PlatformName,
  PlatformOverrides,
  PlatformResult,
  PlatformSelection,
  PlatformStatus,
  PublishError,
  PublishInput,
  PublishOptions,
  PublishProgressEvent,
  PublishResult,
  PublishResultStatus,
} from "./domain/types";

export type { PublisherDependencies } from "./services/publisher";

export {
  createPublisherService,
  getPublishStatus,
  publish,
} from "./services/publisher";
