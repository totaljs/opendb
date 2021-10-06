exports.install = function() {

	ROUTE('+GET    /setup/');

	// API
	ROUTE('API    @setup    +save                      *Setup        --> save');
	ROUTE('API    @setup    -read                      *Setup        --> read');
	ROUTE('API    @setup    -list                      *Setup        --> list');
	ROUTE('API    @setup    -usage                     *Setup        --> consumption');
	ROUTE('API    @setup    -extensions_list           *Extensions   --> list');
	ROUTE('API    @setup    +extensions_save           *Extensions   --> save');
	ROUTE('API    @setup    -extensions_remove/id      *Extensions   --> remove');
	ROUTE('API    @setup    -extensions_download/id    *Extensions   --> download');

	ROUTE('+SOCKET /setup/  @setup');
};
