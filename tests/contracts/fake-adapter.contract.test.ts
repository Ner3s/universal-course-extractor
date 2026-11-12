import { runAdapterContract } from "./adapter-contract.js";
import { FakeAdapter } from "../fixtures/fake-adapter.js";

runAdapterContract("FakeAdapter", {
  create: () => new FakeAdapter("fake", "fake.example.com"),
  supportedUrl: "https://fake.example.com/course",
  unsupportedUrl: "https://other.example.com/course",
});
