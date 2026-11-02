import { configure } from '@testing-library/react';

// Testing Library waits (findBy*, waitFor) default to 1s. Under parallel CI-like load
// several UI tests rendered just past that limit and failed intermittently (seen in
// 9 parallel runs, 02/11). A wider ceiling only lengthens waits that would otherwise
// fail; passing tests resolve as soon as the UI is ready.
configure({ asyncUtilTimeout: 5000 });
