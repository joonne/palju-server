import React from 'react';
import { Route, Switch } from 'react-router-dom';
import { Layout } from './Layout';
import { IndexPage } from './IndexPage';
import { NotFoundPage } from './NotFoundPage';

const renderIndex = () => <IndexPage />;

export const App = () => (
  <Layout>
    <Switch>
      <Route exact path="/" render={renderIndex} />
      <Route component={NotFoundPage} />
    </Switch>
  </Layout>
);

export default App;
