import { configure } from "@testing-library/react-native";

// findBy*/waitFor default to 1 s, which flakes when the machine is busy (e.g. e2e running alongside).
configure({ asyncUtilTimeout: 5000 });
